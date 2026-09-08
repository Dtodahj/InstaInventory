/*
 * db.js — IndexedDB wrapper for Rhoads Show Inventory.
 *
 * Two object stores:
 *   inventory: keyPath "barcode"
 *     { barcode, description, quantity, price, cost, category, condition, notes, photo, updated_at }
 *     — `photo` is a compressed JPEG data URI (or '' if none), resized client-side
 *       before storage so a device photo doesn't blow up IndexedDB/export size.
 *   sales:     keyPath "id"
 *     { id, barcode, description, quantity, sale_price, cost, sold_at }
 *     — `cost` here is a snapshot of the item's cost at the moment it was
 *       sold (not a live reference), so profit stays accurate even if the
 *       item's cost is edited later.
 *     index "sold_at" (for day grouping), index "barcode"
 *
 * Everything here is promise-based. No UI logic lives in this file.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'rhoads-show-inventory';
  const DB_VERSION = 1;
  let dbPromise = null;

  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    // Fallback for older browsers (not expected on iOS Safari 15.4+/modern Chrome/Android).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('inventory')) {
          db.createObjectStore('inventory', { keyPath: 'barcode' });
        }
        if (!db.objectStoreNames.contains('sales')) {
          const sales = db.createObjectStore('sales', { keyPath: 'id' });
          sales.createIndex('sold_at', 'sold_at', { unique: false });
          sales.createIndex('barcode', 'barcode', { unique: false });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
    return dbPromise;
  }

  function tx(storeNames, mode) {
    return openDB().then(function (db) {
      return db.transaction(storeNames, mode);
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // ---------- Inventory ----------

  function getAllInventory() {
    return tx('inventory', 'readonly').then(function (t) {
      return reqToPromise(t.objectStore('inventory').getAll());
    });
  }

  function getInventoryItem(barcode) {
    return tx('inventory', 'readonly').then(function (t) {
      return reqToPromise(t.objectStore('inventory').get(barcode));
    });
  }

  // Adds a new item, or if the barcode already exists, increments its quantity
  // and overwrites description/price with the newly supplied values.
  // Returns the resulting stored item.
  function addOrRestockItem(item) {
    return tx('inventory', 'readwrite').then(function (t) {
      return new Promise(function (resolve, reject) {
        const store = t.objectStore('inventory');
        const getReq = store.get(item.barcode);
        getReq.onsuccess = function () {
          const existing = getReq.result;
          const now = new Date().toISOString();
          let record;
          if (existing) {
            record = {
              barcode: item.barcode,
              description: item.description || existing.description,
              quantity: (existing.quantity || 0) + (item.quantity || 0),
              price: typeof item.price === 'number' ? item.price : existing.price,
              cost: typeof item.cost === 'number' ? item.cost : existing.cost || 0,
              category: item.category || existing.category || '',
              condition: item.condition || existing.condition || '',
              notes: item.notes || existing.notes || '',
              photo: item.photo || existing.photo || '',
              updated_at: now
            };
          } else {
            record = {
              barcode: item.barcode,
              description: item.description || '',
              quantity: item.quantity || 0,
              price: typeof item.price === 'number' ? item.price : 0,
              cost: typeof item.cost === 'number' ? item.cost : 0,
              category: item.category || '',
              condition: item.condition || '',
              notes: item.notes || '',
              photo: item.photo || '',
              updated_at: now
            };
          }
          const putReq = store.put(record);
          putReq.onsuccess = function () { resolve(record); };
          putReq.onerror = function () { reject(putReq.error); };
        };
        getReq.onerror = function () { reject(getReq.error); };
      });
    });
  }

  // Directly overwrites/creates an item as given (used by editing and by import).
  function setItem(record) {
    return tx('inventory', 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore('inventory').put(record));
    });
  }

  function deleteItem(barcode) {
    return tx('inventory', 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore('inventory').delete(barcode));
    });
  }

  // Reduces quantity by `qty`. If it reaches 0 or below, the item is removed
  // from "on hand" (deleted from the inventory store) — its sale is recorded
  // separately in the sales store regardless, so history is preserved.
  // Returns { removed: boolean, item: recordOrNull }.
  function sellFromInventory(barcode, qty) {
    return tx('inventory', 'readwrite').then(function (t) {
      return new Promise(function (resolve, reject) {
        const store = t.objectStore('inventory');
        const getReq = store.get(barcode);
        getReq.onsuccess = function () {
          const existing = getReq.result;
          if (!existing) { resolve({ removed: false, item: null }); return; }
          const remaining = (existing.quantity || 0) - qty;
          if (remaining <= 0) {
            const delReq = store.delete(barcode);
            delReq.onsuccess = function () { resolve({ removed: true, item: null }); };
            delReq.onerror = function () { reject(delReq.error); };
          } else {
            existing.quantity = remaining;
            existing.updated_at = new Date().toISOString();
            const putReq = store.put(existing);
            putReq.onsuccess = function () { resolve({ removed: false, item: existing }); };
            putReq.onerror = function () { reject(putReq.error); };
          }
        };
        getReq.onerror = function () { reject(getReq.error); };
      });
    });
  }

  // ---------- Sales ----------

  function addSale(sale) {
    const record = {
      id: sale.id || uuid(),
      barcode: sale.barcode,
      description: sale.description || '',
      quantity: sale.quantity,
      sale_price: sale.sale_price,
      cost: typeof sale.cost === 'number' ? sale.cost : 0,
      sold_at: sale.sold_at || new Date().toISOString()
    };
    return tx('sales', 'readwrite').then(function (t) {
      return reqToPromise(t.objectStore('sales').put(record));
    }).then(function () { return record; });
  }

  function saleExists(id) {
    return tx('sales', 'readonly').then(function (t) {
      return reqToPromise(t.objectStore('sales').get(id));
    }).then(function (r) { return !!r; });
  }

  function getAllSales() {
    return tx('sales', 'readonly').then(function (t) {
      return reqToPromise(t.objectStore('sales').getAll());
    });
  }

  const DB = {
    uuid: uuid,
    getAllInventory: getAllInventory,
    getInventoryItem: getInventoryItem,
    addOrRestockItem: addOrRestockItem,
    setItem: setItem,
    deleteItem: deleteItem,
    sellFromInventory: sellFromInventory,
    addSale: addSale,
    saleExists: saleExists,
    getAllSales: getAllSales
  };

  global.DB = DB;
})(window);
