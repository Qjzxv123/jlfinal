// DRY function for creating search bar dropdowns for Supabase tables
// Usage: createSearchBarDropdown(tableName, fields, filters, containerId, onSelect)
async function createSearchBarDropdown(tableName, fields, filters, containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Fetch data from Supabase
  let query = supabase.from(tableName).select(fields.join(', '));
  if (filters && filters.length) {
    filters.forEach(f => {
      if (f.type === 'eq') query = query.eq(f.field, f.value);
      if (f.type === 'neq') query = query.neq(f.field, f.value);
      // Add more filter types as needed
    });
  }
  const { data, error } = await query;
  if (error) {
    container.innerHTML = `<div style='color:red;'>Error loading ${tableName}: ${error.message}</div>`;
    return;
  }
  const allItems = data || [];
  const dropdownHTML = `
    <div class="product-dropdown-container">
      <input id="productSearch" type="text" class="product-search" placeholder="Type to search..." />
      <div class="product-dropdown" style="display: none;"></div>
    </div>
  `;
  container.innerHTML = dropdownHTML;
  const searchInput = document.getElementById('productSearch');
  const dropdown = container.querySelector('.product-dropdown');
  function updateDropdown(searchTerm = '') {
    const filtered = allItems.filter(item => {
      const searchText = fields.map(f => item[f] || '').join(' ').toLowerCase();
      return searchText.includes(searchTerm.toLowerCase());
    });
    dropdown.innerHTML = '';
    filtered.slice(0, 20).forEach(item => {
      const option = document.createElement('div');
      option.className = 'product-option';
      option.innerHTML = `
        <div class="product-name">${fields.map(f => item[f]).join(' - ')}</div>
        <div class="product-details">${fields.map(f => `${f}: ${item[f] || ''}`).join(' | ')}</div>
      `;
      option.addEventListener('click', () => {
        if (onSelect) onSelect(item);
        searchInput.value = '';
        dropdown.style.display = 'none';
      });
      dropdown.appendChild(option);
    });
    if (filtered.length === 0) {
      dropdown.innerHTML = '<div class="product-option" style="color: #6b7280; font-style: italic;">No results found</div>';
    }
  }
  // Show dropdown when input is focused
  searchInput.addEventListener('focus', () => {
    updateDropdown(searchInput.value);
    dropdown.style.display = 'block';
  });

  // Update dropdown as user types
  searchInput.addEventListener('input', (e) => {
    updateDropdown(e.target.value);
    dropdown.style.display = 'block';
  });

  // Hide dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

// Export for usage in other scripts
window.createSearchBarDropdown = createSearchBarDropdown;
