/*
 * export-import.js — JSON/CSV export, and JSON import with a barcode-keyed
 * merge that surfaces conflicts to the user instead of guessing.
 */
(function (global) {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }

  function timestampForFilename(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function triggerDownload(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvEscape(value) {
    const s = value === null || value === undefined ? '' : String(value);
    if (/[",\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCSV(rows, columns) {
    const lines = [columns.join(',')];
    rows.forEach(function (row) {
      lines.push(columns.map(function (c) { return csvEscape(row[c]); }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- Export ----------

  function buildExportPayload() {
    return Promise.all([DB.getAllInventory(), DB.getAllSales()]).then(function (results) {
      const inventory = results[0], sales = results[1];
      return {
        exported_at: new Date().toISOString(),
        inventory: inventory.map(function (i) {
          return {
            barcode: i.barcode, description: i.description, quantity: i.quantity, price: i.price,
            cost: i.cost || 0, category: i.category || '', condition: i.condition || '', notes: i.notes || '',
            photo: i.photo || ''
          };
        }),
        sales: sales.map(function (s) {
          return {
            id: s.id, barcode: s.barcode, description: s.description,
            quantity: s.quantity, sale_price: s.sale_price, cost: s.cost || 0, sold_at: s.sold_at
          };
        })
      };
    });
  }

  function exportJSON() {
    return buildExportPayload().then(function (payload) {
      triggerDownload(
        'rhoads-show-inventory-' + timestampForFilename() + '.json',
        JSON.stringify(payload, null, 2),
        'application/json'
      );
      return payload;
    });
  }

  function exportInventoryCSV() {
    // photo is intentionally left out of the CSV — a base64 image would make
    // rows unreadable in a spreadsheet. It's still in the JSON export below.
    return DB.getAllInventory().then(function (inventory) {
      const csv = toCSV(inventory, ['barcode', 'description', 'category', 'condition', 'quantity', 'cost', 'price', 'notes']);
      triggerDownload('inventory-' + timestampForFilename() + '.csv', csv, 'text/csv');
    });
  }

  function exportSalesCSV() {
    return DB.getAllSales().then(function (sales) {
      const csv = toCSV(sales, ['id', 'barcode', 'description', 'quantity', 'cost', 'sale_price', 'sold_at']);
      triggerDownload('sales-' + timestampForFilename() + '.csv', csv, 'text/csv');
    });
  }

  // ---------- Import ----------

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  function fieldsDiffer(a, b) {
    return a.description !== b.description || a.quantity !== b.quantity || a.price !== b.price ||
      (a.cost || 0) !== (b.cost || 0) || (a.category || '') !== (b.category || '') ||
      (a.condition || '') !== (b.condition || '') || (a.notes || '') !== (b.notes || '') ||
      (a.photo || '') !== (b.photo || '');
  }

  // Builds a merge plan comparing imported data against what's on hand now.
  // Does not touch the database. Returns:
  //   { newItems: [...], conflicts: [{barcode, local, imported}], salesToAdd: [...], duplicateSales: n }
  function planImport(importedData) {
    if (!importedData || !Array.isArray(importedData.inventory) || !Array.isArray(importedData.sales)) {
      return Promise.reject(new Error('That file does not look like a Rhoads Show Inventory export (missing inventory/sales arrays).'));
    }
    return Promise.all([DB.getAllInventory(), DB.getAllSales()]).then(function (results) {
      const localInventory = results[0], localSales = results[1];
      const localByBarcode = {};
      localInventory.forEach(function (i) { localByBarcode[i.barcode] = i; });

      const newItems = [];
      const conflicts = [];
      importedData.inventory.forEach(function (item) {
        const local = localByBarcode[item.barcode];
        if (!local) {
          newItems.push(item);
        } else if (fieldsDiffer(local, item)) {
          conflicts.push({ barcode: item.barcode, local: local, imported: item });
        }
        // identical items: nothing to do
      });

      // Dedupe sales: prefer matching by id; fall back to a composite key
      // for older exports that predate the id field.
      const localSaleIds = new Set(localSales.map(function (s) { return s.id; }).filter(Boolean));
      const localSaleComposite = new Set(localSales.map(function (s) {
        return s.barcode + '|' + s.sold_at + '|' + s.quantity + '|' + s.sale_price;
      }));

      const salesToAdd = [];
      let duplicateSales = 0;
      importedData.sales.forEach(function (sale) {
        const isDupById = sale.id && localSaleIds.has(sale.id);
        const compositeKey = sale.barcode + '|' + sale.sold_at + '|' + sale.quantity + '|' + sale.sale_price;
        const isDupByComposite = !sale.id && localSaleComposite.has(compositeKey);
        if (isDupById || isDupByComposite) {
          duplicateSales++;
        } else {
          salesToAdd.push(sale);
        }
      });

      return { newItems: newItems, conflicts: conflicts, salesToAdd: salesToAdd, duplicateSales: duplicateSales };
    });
  }

  // resolutions: array parallel to plan.conflicts, each one of
  // 'keep_local' | 'use_imported' | 'sum_quantity'
  function applyImport(plan, resolutions) {
    const writes = [];

    plan.newItems.forEach(function (item) {
      writes.push(DB.setItem({
        barcode: item.barcode,
        description: item.description || '',
        quantity: item.quantity || 0,
        price: typeof item.price === 'number' ? item.price : 0,
        cost: typeof item.cost === 'number' ? item.cost : 0,
        category: item.category || '',
        condition: item.condition || '',
        notes: item.notes || '',
        photo: item.photo || '',
        updated_at: new Date().toISOString()
      }));
    });

    plan.conflicts.forEach(function (conflict, idx) {
      const choice = resolutions[idx] || 'sum_quantity';
      let record;
      if (choice === 'keep_local') {
        record = null; // no write needed
      } else if (choice === 'use_imported') {
        record = {
          barcode: conflict.barcode,
          description: conflict.imported.description,
          quantity: conflict.imported.quantity,
          price: conflict.imported.price,
          cost: conflict.imported.cost || 0,
          category: conflict.imported.category || '',
          condition: conflict.imported.condition || '',
          notes: conflict.imported.notes || '',
          photo: conflict.imported.photo || '',
          updated_at: new Date().toISOString()
        };
      } else { // sum_quantity — quantities combine, everything else stays as it is locally
        record = {
          barcode: conflict.barcode,
          description: conflict.local.description,
          quantity: (conflict.local.quantity || 0) + (conflict.imported.quantity || 0),
          price: conflict.local.price,
          cost: conflict.local.cost || 0,
          category: conflict.local.category || '',
          condition: conflict.local.condition || '',
          notes: conflict.local.notes || '',
          photo: conflict.local.photo || '',
          updated_at: new Date().toISOString()
        };
      }
      if (record) writes.push(DB.setItem(record));
    });

    plan.salesToAdd.forEach(function (sale) {
      writes.push(DB.addSale(sale));
    });

    return Promise.all(writes);
  }

  global.ExportImport = {
    exportJSON: exportJSON,
    exportInventoryCSV: exportInventoryCSV,
    exportSalesCSV: exportSalesCSV,
    readFileAsText: readFileAsText,
    planImport: planImport,
    applyImport: applyImport
  };
})(window);
