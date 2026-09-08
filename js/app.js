/*
 * app.js — UI wiring for Rhoads Show Inventory. One page, three tabs,
 * everything else is a bottom sheet or full-screen overlay so the
 * underlying list never loses its scroll position.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function money(n) { return '$' + (Number(n) || 0).toFixed(2); }

  const state = {
    search: '',
    sellBarcode: null,
    editBarcode: null,   // set when the form is editing an existing item
    scanMode: null,      // 'add' | 'sell'
    scanHandled: false,
    pendingImport: null  // { plan, data }
  };

  // ---------------------------------------------------------------------
  // Sheets / overlays
  // ---------------------------------------------------------------------

  function openBackdrop(id) { $(id).hidden = false; }
  function closeBackdrop(id) { $(id).hidden = true; }

  function closeAllSheets() {
    document.querySelectorAll('.sheet-backdrop').forEach(function (el) { el.hidden = true; });
  }

  document.addEventListener('click', function (e) {
    if (e.target.matches('[data-close-sheet]')) {
      closeAllSheets();
    }
    // Tapping the dark backdrop itself (not the sheet content) closes it.
    if (e.target.classList.contains('sheet-backdrop')) {
      e.target.hidden = true;
    }
  });

  let toastTimer = null;
  function toast(message, ms) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------

  document.querySelectorAll('.tab').forEach(function (tabBtn) {
    tabBtn.addEventListener('click', function () {
      const target = tabBtn.getAttribute('data-target');
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === tabBtn); });
      document.querySelectorAll('.view').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== target; });
      if (target === 'sales') renderSales();
      if (target === 'data') renderStorageSummary();
      if (target === 'inventory') renderInventory();
    });
  });

  // ---------------------------------------------------------------------
  // Inventory rendering
  // ---------------------------------------------------------------------

  function renderInventory() {
    return DB.getAllInventory().then(function (items) {
      const q = state.search.trim().toLowerCase();
      const filtered = items.filter(function (i) {
        if (!q) return true;
        return (i.description || '').toLowerCase().indexOf(q) !== -1 ||
               (i.barcode || '').toLowerCase().indexOf(q) !== -1;
      }).sort(function (a, b) {
        return (a.description || a.barcode).localeCompare(b.description || b.barcode);
      });

      const list = $('inventory-list');
      list.innerHTML = '';
      filtered.forEach(function (item) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'item-row';
        row.setAttribute('data-barcode', item.barcode);
        row.innerHTML =
          '<div class="item-row-main">' +
            '<div class="item-row-desc">' + escapeHtml(item.description || '(no description)') + '</div>' +
            '<div class="item-row-barcode">' + escapeHtml(item.barcode) + '</div>' +
          '</div>' +
          '<div class="item-row-side">' +
            '<div class="item-row-price">' + money(item.price) + '</div>' +
            '<div class="item-row-qty">' + item.quantity + ' on hand</div>' +
          '</div>';
        row.addEventListener('click', function () { openSellActionSheet(item.barcode); });
        list.appendChild(row);
      });
      $('inventory-empty').hidden = filtered.length > 0;
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  $('inventory-search').addEventListener('input', function (e) {
    state.search = e.target.value;
    renderInventory();
  });

  // ---------------------------------------------------------------------
  // Sell-action sheet (tap a row) -> Sell or Edit
  // ---------------------------------------------------------------------

  function openSellActionSheet(barcode) {
    state.sellBarcode = barcode;
    openBackdrop('sheet-sell-action-backdrop');
  }

  $('btn-sell-item').addEventListener('click', function () {
    closeAllSheets();
    openSellSheet(state.sellBarcode);
  });

  $('btn-edit-item').addEventListener('click', function () {
    closeAllSheets();
    DB.getInventoryItem(state.sellBarcode).then(function (item) {
      if (item) openItemForm({ mode: 'edit', item: item });
    });
  });

  // ---------------------------------------------------------------------
  // Add / Edit form
  // ---------------------------------------------------------------------

  function openItemForm(opts) {
    // opts: { mode: 'add'|'edit', barcode?: prefill, item?: existing record for edit or restock context }
    const barcodeField = $('field-barcode');
    const descField = $('field-description');
    const qtyField = $('field-quantity');
    const priceField = $('field-price');
    const hint = $('form-hint');

    state.editBarcode = null;
    hint.textContent = '';

    if (opts.mode === 'edit') {
      state.editBarcode = opts.item.barcode;
      $('form-title').textContent = 'Edit item';
      $('form-submit').textContent = 'Save changes';
      barcodeField.value = opts.item.barcode;
      barcodeField.disabled = true;
      descField.value = opts.item.description || '';
      qtyField.value = opts.item.quantity;
      priceField.value = Number(opts.item.price || 0).toFixed(2);
      hint.textContent = 'Editing sets these values exactly (it does not add to the current count).';
    } else {
      $('form-title').textContent = 'Add item';
      $('form-submit').textContent = 'Save item';
      barcodeField.disabled = false;
      barcodeField.value = opts.barcode || '';
      if (opts.existing) {
        descField.value = opts.existing.description || '';
        priceField.value = Number(opts.existing.price || 0).toFixed(2);
        qtyField.value = 1;
        hint.textContent = 'This barcode is already in your inventory (' + opts.existing.quantity +
          ' on hand). The quantity you enter here will be ADDED to that count.';
      } else {
        descField.value = '';
        priceField.value = '0.00';
        qtyField.value = 1;
      }
    }
    openBackdrop('sheet-form-backdrop');
    const focusTarget = (opts.mode !== 'edit' && !opts.barcode) ? barcodeField : descField;
    setTimeout(function () { focusTarget.focus(); }, 50);
  }

  $('btn-manual-add').addEventListener('click', function () {
    closeAllSheets();
    openItemForm({ mode: 'add' });
  });

  $('item-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const barcode = $('field-barcode').value.trim();
    const description = $('field-description').value.trim();
    const quantity = parseInt($('field-quantity').value, 10) || 0;
    const price = parseFloat($('field-price').value) || 0;

    if (!barcode) { toast('Barcode is required.'); return; }

    const action = state.editBarcode
      ? DB.setItem({ barcode: state.editBarcode, description: description, quantity: quantity, price: price, updated_at: new Date().toISOString() })
      : DB.addOrRestockItem({ barcode: barcode, description: description, quantity: quantity, price: price });

    action.then(function () {
      closeAllSheets();
      $('field-barcode').disabled = false;
      renderInventory();
      toast(state.editBarcode ? 'Item updated.' : 'Item saved.');
    }).catch(function (err) {
      toast('Could not save: ' + err.message);
    });
  });

  // ---------------------------------------------------------------------
  // Sell form
  // ---------------------------------------------------------------------

  function openSellSheet(barcode) {
    DB.getInventoryItem(barcode).then(function (item) {
      if (!item) { toast('Item not found.'); return; }
      state.sellBarcode = barcode;
      $('sell-description').textContent = item.description || '(no description)';
      $('sell-barcode').textContent = item.barcode;
      $('sell-onhand').textContent = item.quantity + ' on hand';
      $('sell-quantity').value = 1;
      $('sell-quantity').max = item.quantity;
      $('sell-price').value = Number(item.price || 0).toFixed(2);
      $('sell-error').hidden = true;
      updateSellTotal();
      openBackdrop('sheet-sell-backdrop');
    });
  }

  function updateSellTotal() {
    const qty = parseInt($('sell-quantity').value, 10) || 0;
    const price = parseFloat($('sell-price').value) || 0;
    $('sell-total').textContent = money(qty * price);
  }
  $('sell-quantity').addEventListener('input', updateSellTotal);
  $('sell-price').addEventListener('input', updateSellTotal);
  $('qty-minus').addEventListener('click', function () {
    const f = $('sell-quantity');
    f.value = Math.max(1, (parseInt(f.value, 10) || 1) - 1);
    updateSellTotal();
  });
  $('qty-plus').addEventListener('click', function () {
    const f = $('sell-quantity');
    const max = parseInt(f.max, 10) || Infinity;
    f.value = Math.min(max, (parseInt(f.value, 10) || 1) + 1);
    updateSellTotal();
  });

  $('btn-confirm-sell').addEventListener('click', function () {
    const barcode = state.sellBarcode;
    const qty = parseInt($('sell-quantity').value, 10) || 0;
    const price = parseFloat($('sell-price').value) || 0;

    DB.getInventoryItem(barcode).then(function (item) {
      if (!item) { toast('Item no longer exists.'); closeAllSheets(); return; }
      if (qty < 1 || qty > item.quantity) {
        $('sell-error').textContent = 'Enter a quantity between 1 and ' + item.quantity + '.';
        $('sell-error').hidden = false;
        return;
      }
      const description = item.description;
      DB.sellFromInventory(barcode, qty).then(function () {
        return DB.addSale({ barcode: barcode, description: description, quantity: qty, sale_price: price, sold_at: new Date().toISOString() });
      }).then(function () {
        closeAllSheets();
        renderInventory();
        renderSales();
        toast('Sold ' + qty + ' — ' + money(qty * price));
      });
    });
  });

  // ---------------------------------------------------------------------
  // Scanner
  // ---------------------------------------------------------------------

  function openScanner(mode) {
    state.scanMode = mode;
    state.scanHandled = false;
    $('scanner-mode-label').textContent = mode === 'sell' ? 'Scan to sell' : 'Scan to add';
    $('scanner-status').textContent = 'Point the camera at a barcode…';
    $('scanner-overlay').hidden = false;

    if (!Scanner.isSupported()) {
      $('scanner-status').textContent = 'Camera not available on this device/browser.';
      return;
    }

    Scanner.start($('scanner-video'), onScanResult, function (err) {
      $('scanner-status').textContent = 'Could not start camera: ' + (err && err.message ? err.message : err) +
        '. You can close this and enter the item manually instead.';
    });
  }

  function closeScanner() {
    Scanner.stop();
    $('scanner-overlay').hidden = true;
  }

  $('scanner-close').addEventListener('click', closeScanner);

  function onScanResult(text) {
    if (state.scanHandled) return;
    state.scanHandled = true;
    closeScanner();

    if (state.scanMode === 'add') {
      DB.getInventoryItem(text).then(function (existing) {
        openItemForm({ mode: 'add', barcode: text, existing: existing || null });
      });
    } else if (state.scanMode === 'sell') {
      DB.getInventoryItem(text).then(function (existing) {
        if (existing) {
          openSellSheet(text);
        } else {
          toast('No item with barcode ' + text + '. Add it first.');
        }
      });
    }
  }

  $('btn-scan-to-add').addEventListener('click', function () { closeAllSheets(); openScanner('add'); });
  $('btn-scan-to-sell').addEventListener('click', function () { openScanner('sell'); });

  // ---------------------------------------------------------------------
  // FAB
  // ---------------------------------------------------------------------

  $('fab-add').addEventListener('click', function () { openBackdrop('sheet-add-action-backdrop'); });

  // ---------------------------------------------------------------------
  // Sales-by-day rendering
  // ---------------------------------------------------------------------

  function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  function formatDayLabel(d) {
    const today = new Date();
    const yest = new Date(); yest.setDate(today.getDate() - 1);
    if (dayKey(d) === dayKey(today)) return 'Today';
    if (dayKey(d) === dayKey(yest)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function renderSales() {
    return DB.getAllSales().then(function (sales) {
      const groups = {}; // key -> { date, sales: [] }
      sales.forEach(function (s) {
        const d = new Date(s.sold_at);
        const key = dayKey(d);
        if (!groups[key]) groups[key] = { date: d, sales: [] };
        groups[key].sales.push(s);
      });
      const keys = Object.keys(groups).sort(function (a, b) { return groups[b].date - groups[a].date; });

      const container = $('sales-days');
      container.innerHTML = '';
      keys.forEach(function (key, idx) {
        const group = groups[key];
        group.sales.sort(function (a, b) { return new Date(b.sold_at) - new Date(a.sold_at); });
        const total = group.sales.reduce(function (sum, s) { return sum + s.quantity * s.sale_price; }, 0);

        const el = document.createElement('div');
        el.className = 'day-group' + (idx === 0 ? ' expanded' : '');
        el.innerHTML =
          '<button type="button" class="day-header">' +
            '<span class="day-header-label">' + formatDayLabel(group.date) + ' <span style="color:var(--text-muted);font-weight:400;">(' + group.sales.length + ')</span></span>' +
            '<span style="display:flex;align-items:center;gap:8px;">' +
              '<span class="day-header-total">' + money(total) + '</span>' +
              '<svg class="day-chevron" viewBox="0 0 24 24" width="18" height="18"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</span>' +
          '</button>' +
          '<div class="day-sales"></div>';

        const salesEl = el.querySelector('.day-sales');
        group.sales.forEach(function (s) {
          const line = document.createElement('div');
          line.className = 'sale-line';
          const time = new Date(s.sold_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          line.innerHTML =
            '<div>' +
              '<div class="sale-line-desc">' + escapeHtml(s.description || s.barcode) + '</div>' +
              '<div class="sale-line-meta">' + s.quantity + ' × ' + money(s.sale_price) + ' · ' + time + '</div>' +
            '</div>' +
            '<div class="sale-line-amt">' + money(s.quantity * s.sale_price) + '</div>';
          salesEl.appendChild(line);
        });

        el.querySelector('.day-header').addEventListener('click', function () {
          el.classList.toggle('expanded');
        });

        container.appendChild(el);
      });
      $('sales-empty').hidden = keys.length > 0;
    });
  }

  // ---------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------

  $('btn-export-json').addEventListener('click', function () {
    ExportImport.exportJSON().then(function () { toast('Exported JSON file.'); });
  });
  $('btn-export-inv-csv').addEventListener('click', function () {
    ExportImport.exportInventoryCSV().then(function () { toast('Exported inventory CSV.'); });
  });
  $('btn-export-sales-csv').addEventListener('click', function () {
    ExportImport.exportSalesCSV().then(function () { toast('Exported sales CSV.'); });
  });

  $('import-file-input').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    ExportImport.readFileAsText(file).then(function (text) {
      let data;
      try { data = JSON.parse(text); } catch (err) { throw new Error('That file is not valid JSON.'); }
      return ExportImport.planImport(data);
    }).then(function (plan) {
      state.pendingImport = plan;
      renderImportPreview(plan);
      openBackdrop('sheet-import-backdrop');
    }).catch(function (err) {
      toast(err.message || 'Could not read that file.');
    }).finally(function () {
      e.target.value = '';
    });
  });

  function renderImportPreview(plan) {
    $('import-summary').innerHTML =
      plan.newItems.length + ' new item(s) to add<br>' +
      plan.conflicts.length + ' item(s) already on file with different values<br>' +
      plan.salesToAdd.length + ' new sale(s) to add' +
      (plan.duplicateSales ? ' (' + plan.duplicateSales + ' duplicate sale(s) skipped)' : '');

    const container = $('import-conflicts');
    container.innerHTML = '';

    if (plan.conflicts.length > 0) {
      const applyAllRow = document.createElement('label');
      applyAllRow.className = 'apply-all-row';
      applyAllRow.innerHTML = '<input type="checkbox" id="apply-all-checkbox"> Use the first choice below for all conflicts';
      container.appendChild(applyAllRow);
    }

    plan.conflicts.forEach(function (c, idx) {
      const card = document.createElement('div');
      card.className = 'conflict-card';
      card.setAttribute('data-idx', idx);
      const name = c.imported.description || c.local.description || c.barcode;
      card.innerHTML =
        '<h3>' + escapeHtml(name) + '</h3>' +
        '<div class="conflict-detail">' +
          'Barcode ' + escapeHtml(c.barcode) + '<br>' +
          'Current: ' + c.local.quantity + ' on hand @ ' + money(c.local.price) +
          (c.local.description !== c.imported.description ? ' — "' + escapeHtml(c.local.description) + '"' : '') + '<br>' +
          'Imported: ' + c.imported.quantity + ' on hand @ ' + money(c.imported.price) +
          (c.local.description !== c.imported.description ? ' — "' + escapeHtml(c.imported.description) + '"' : '') +
        '</div>' +
        '<div class="conflict-choices">' +
          '<label class="conflict-choice"><input type="radio" name="conflict-' + idx + '" value="sum_quantity" checked> Merge: add quantities together (' + ((c.local.quantity||0) + (c.imported.quantity||0)) + ' on hand), keep current description/price</label>' +
          '<label class="conflict-choice"><input type="radio" name="conflict-' + idx + '" value="use_imported"> Use the imported values, replacing current</label>' +
          '<label class="conflict-choice"><input type="radio" name="conflict-' + idx + '" value="keep_local"> Keep current values, ignore imported</label>' +
        '</div>';
      container.appendChild(card);
    });

    const applyAllCheckbox = $('apply-all-checkbox');
    if (applyAllCheckbox) {
      const syncAll = function () {
        if (!applyAllCheckbox.checked) return;
        const firstChoice = container.querySelector('input[name="conflict-0"]:checked');
        if (!firstChoice) return;
        plan.conflicts.forEach(function (c, idx) {
          const radio = container.querySelector('input[name="conflict-' + idx + '"][value="' + firstChoice.value + '"]');
          if (radio) radio.checked = true;
        });
      };
      applyAllCheckbox.addEventListener('change', syncAll);
      container.addEventListener('change', function (e) {
        if (e.target.name === 'conflict-0') syncAll();
      });
    }
  }

  $('btn-confirm-import').addEventListener('click', function () {
    const plan = state.pendingImport;
    if (!plan) { closeAllSheets(); return; }
    const resolutions = plan.conflicts.map(function (c, idx) {
      const checked = document.querySelector('input[name="conflict-' + idx + '"]:checked');
      return checked ? checked.value : 'sum_quantity';
    });
    ExportImport.applyImport(plan, resolutions).then(function () {
      closeAllSheets();
      renderInventory();
      renderSales();
      renderStorageSummary();
      toast('Import complete: ' + plan.newItems.length + ' added, ' + plan.conflicts.length +
        ' merged, ' + plan.salesToAdd.length + ' sale(s) added.');
      state.pendingImport = null;
    });
  });

  // ---------------------------------------------------------------------
  // Storage summary / online indicator
  // ---------------------------------------------------------------------

  function renderStorageSummary() {
    return Promise.all([DB.getAllInventory(), DB.getAllSales()]).then(function (results) {
      const inv = results[0], sales = results[1];
      const totalUnits = inv.reduce(function (s, i) { return s + i.quantity; }, 0);
      const totalRevenue = sales.reduce(function (s, sale) { return s + sale.quantity * sale.sale_price; }, 0);
      $('storage-summary').textContent =
        inv.length + ' item type(s), ' + totalUnits + ' unit(s) on hand · ' +
        sales.length + ' sale(s) recorded, ' + money(totalRevenue) + ' lifetime · data stored only on this device.';
    });
  }

  function updateOnlineDot() {
    $('online-dot').classList.toggle('offline', !navigator.onLine);
    $('online-dot').title = navigator.onLine ? 'Online' : 'Offline (still fully usable)';
  }
  window.addEventListener('online', updateOnlineDot);
  window.addEventListener('offline', updateOnlineDot);

  // ---------------------------------------------------------------------
  // Service worker
  // ---------------------------------------------------------------------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('Service worker registration failed (app still works, just without offline caching):', err);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  updateOnlineDot();
  renderInventory();
})();
