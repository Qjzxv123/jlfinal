(function() {
  if (window.openItemSelectorModal) return;

  const modalId = 'item-selector-modal';
  const datalistId = 'item-selector-options';
  let currentConfig = null;
  let cachedOptions = {};

  function ensureStyles() {
    if (document.getElementById('item-selector-modal-styles')) return;
    const style = document.createElement('style');
    style.id = 'item-selector-modal-styles';
    style.textContent = `
      #${modalId} {
        display: none;
        position: fixed;
        z-index: 4000;
        inset: 0;
        background: rgba(0,0,0,0.35);
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      #${modalId} .modal-shell {
        background: white;
        width: min(720px, 94vw);
        border-radius: 14px;
        padding: 24px 24px 20px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.18);
        max-height: 86vh;
        overflow-y: auto;
        position: relative;
      }
      #${modalId} .modal-close {
        position: absolute;
        top: 14px;
        right: 16px;
        font-size: 26px;
        color: #888;
        cursor: pointer;
      }
      #${modalId} h3 {
        margin: 0 0 6px 0;
        color: #2c3e50;
        font-size: 1.35rem;
      }
      #${modalId} .description {
        color: #555;
        margin-bottom: 12px;
        font-size: 0.98rem;
      }
      #${modalId} .item-rows {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 12px 0 6px;
      }
      #${modalId} .item-row {
        display: grid;
        grid-template-columns: 1fr 120px 44px;
        gap: 10px;
        align-items: center;
      }
      #${modalId} .item-input,
      #${modalId} .qty-input {
        padding: 10px 12px;
        border-radius: 8px;
        border: 1.5px solid #e1e5e9;
        font-size: 0.98rem;
        width: 100%;
        box-sizing: border-box;
      }
      #${modalId} .qty-input {
        text-align: center;
      }
      #${modalId} .remove-btn {
        background: #e74c3c;
        border: none;
        color: white;
        width: 100%;
        height: 40px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 18px;
      }
      #${modalId} .add-btn,
      #${modalId} .primary-btn,
      #${modalId} .secondary-btn {
        border: none;
        border-radius: 8px;
        padding: 10px 14px;
        cursor: pointer;
        font-size: 0.98rem;
      }
      #${modalId} .add-btn {
        background: #4DBA93;
        color: white;
        width: fit-content;
        margin-top: 6px;
      }
      #${modalId} .actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 12px;
      }
      #${modalId} .primary-btn {
        background: #4DBA93;
        color: white;
        min-width: 120px;
      }
      #${modalId} .secondary-btn {
        background: #b0b0b0;
        color: #2c3e50;
        min-width: 110px;
      }
      #${modalId} .status {
        color: #e74c3c;
        font-size: 0.92rem;
        min-height: 18px;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    if (document.getElementById(modalId)) return;
    const overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.innerHTML = `
      <div class="modal-shell">
        <span class="modal-close" id="${modalId}-close">&times;</span>
        <h3 id="${modalId}-title"></h3>
        <div class="description" id="${modalId}-description"></div>
        <div class="item-rows" id="${modalId}-rows"></div>
        <button class="add-btn" id="${modalId}-add">+ Add Item</button>
        <div class="status" id="${modalId}-status"></div>
        <div class="actions">
          <button class="secondary-btn" id="${modalId}-cancel">Cancel</button>
          <button class="primary-btn" id="${modalId}-confirm">Add Items</button>
        </div>
        <datalist id="${datalistId}"></datalist>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#' + modalId + '-close').onclick = close;
    overlay.querySelector('#' + modalId + '-cancel').onclick = close;
    overlay.querySelector('#' + modalId + '-add').onclick = addRow;
    overlay.querySelector('#' + modalId + '-confirm').onclick = confirm;
  }

  function close() {
    const overlay = document.getElementById(modalId);
    if (overlay) overlay.style.display = 'none';
    currentConfig = null;
  }

  function addRow(prefill) {
    const rows = document.getElementById(modalId + '-rows');
    if (!rows) return;
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input type="text" class="item-input" list="${datalistId}" placeholder="Search SKU or name..." value="${(prefill && prefill.display) || ''}">
      <input type="number" class="qty-input" min="1" value="${(prefill && prefill.quantity) || 1}" placeholder="Qty">
      <button type="button" class="remove-btn">&times;</button>
    `;
    row.querySelector('.remove-btn').onclick = () => {
      row.remove();
      if (!rows.children.length) addRow();
    };
    row.querySelector('.item-input').addEventListener('input', () => {
      const status = document.getElementById(modalId + '-status');
      if (status) status.textContent = '';
    });
    rows.appendChild(row);
  }

  async function loadOptions(tableName, columnName, labelName = 'Name') {
    const cacheKey = JSON.stringify(tableName) + '::' + columnName + '::' + labelName;
    if (cachedOptions[cacheKey]) return cachedOptions[cacheKey];

    const list = [];
    try {
      if (Array.isArray(tableName)) {
        for (const entry of tableName) {
          const table = entry.table || entry.tableName || entry.name;
          const column = entry.column || entry.columnName || columnName;
          const label = entry.label || entry.labelName || labelName || 'Name';
          if (!table || !column) continue;
          const { data, error } = await supabase.from(table).select(`${column}, ${label}`).order(column);
          if (!error && Array.isArray(data)) {
            data.forEach(row => {
              const value = row[column];
              const labelText = row[label] || '';
              if (value) {
                list.push({ value, label: labelText });
              }
            });
          }
        }
      } else {
        const { data, error } = await supabase.from(tableName).select(`${columnName}, ${labelName}`).order(columnName);
        if (!error && Array.isArray(data)) {
          data.forEach(row => {
            const value = row[columnName];
            const labelText = row[labelName] || '';
            if (value) {
              list.push({ value, label: labelText });
            }
          });
        }
      }
    } catch (e) {
      console.error('Error loading item selector options', e);
    }
    cachedOptions[cacheKey] = list;
    return list;
  }

  function renderOptions(options) {
    const datalist = document.getElementById(datalistId);
    if (!datalist) return;
    datalist.innerHTML = options
      .map(opt => `<option value="${opt.value}" label="${opt.label ? opt.label.replace(/\"/g,'&quot;') : ''}">${opt.value}${opt.label ? ' - ' + opt.label : ''}</option>`)
      .join('');
  }

  function hydrateRows(initialItems, options) {
    const rows = document.getElementById(modalId + '-rows');
    if (!rows) return;
    rows.innerHTML = '';
    if (initialItems && initialItems.length) {
      initialItems.forEach(item => {
        const match = options.find(opt => opt.value === item.value);
        addRow({
          display: match ? `${match.value}${match.label ? ' - ' + match.label : ''}` : (item.display || item.value || ''),
          quantity: item.quantity || 1
        });
      });
    } else {
      addRow();
    }
  }

  async function openItemSelectorModal(config) {
    ensureStyles();
    ensureModal();
    currentConfig = config || {};
    const overlay = document.getElementById(modalId);
    if (!overlay) return;

    document.getElementById(modalId + '-title').textContent = config.headerText || 'Select Items';
    document.getElementById(modalId + '-description').textContent = config.descriptionText || '';
    document.getElementById(modalId + '-status').textContent = '';

    const options = await loadOptions(config.tableName, config.columnName, config.labelName || 'Name');
    renderOptions(options);
    hydrateRows(config.initialItems, options);
    overlay.style.display = 'flex';
  }

  function confirm() {
    if (!currentConfig) return close();
    const status = document.getElementById(modalId + '-status');
    const options = Array.from((document.getElementById(datalistId) || { options: [] }).options).map(opt => ({
      value: opt.value,
      label: opt.getAttribute('label') || ''
    }));
    const rows = document.querySelectorAll(`#${modalId}-rows .item-row`);
    const items = [];
    for (const row of rows) {
      const input = row.querySelector('.item-input');
      const qtyInput = row.querySelector('.qty-input');
      const rawValue = (input.value || '').trim();
      const qty = parseInt(qtyInput.value, 10);
      if (!rawValue) continue;
      if (!qty || qty < 1) {
        if (status) status.textContent = 'Please enter a quantity of 1 or more for each item.';
        return;
      }
      const match = options.find(opt => opt.value === rawValue || rawValue.startsWith(opt.value + ' '));
      const value = match ? match.value : rawValue;
      const label = match ? match.label : '';
      items.push({ value, label, quantity: qty, display: match ? `${value}${label ? ' - ' + label : ''}` : rawValue });
    }
    if (!items.length) {
      if (status) status.textContent = 'Add at least one item to continue.';
      return;
    }
    if (typeof currentConfig.onConfirm === 'function') {
      currentConfig.onConfirm(items);
    }
    close();
  }

  window.openItemSelectorModal = openItemSelectorModal;
})();
