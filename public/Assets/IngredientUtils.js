// IngredientUtils.js
// Shared functions to add/remove ingredient quantity from the Ingredients table
// Handles unit conversion from the provided unit to the storage unit

/**
 * Adds quantity to an ingredient in the Ingredients table
 * @param {string} SKU - The IngredientSKU to update
 * @param {number} Quantity - The quantity to add (in the provided unit)
 * @param {string} Unit - The unit of the provided quantity (e.g., 'lb', 'kg', 'oz', 'g')
 * @returns {Promise<object>} - Returns { success: boolean, newQuantity: number, message: string }
 */
async function IngredientAdd(SKU, Quantity, Unit) {
  return await IngredientUpdate(SKU, Quantity, Unit, 'add');
}

/**
 * Removes/subtracts quantity from an ingredient in the Ingredients table
 * @param {string} SKU - The IngredientSKU to update
 * @param {number} Quantity - The quantity to subtract (in the provided unit)
 * @param {string} Unit - The unit of the provided quantity (e.g., 'lb', 'kg', 'oz', 'g')
 * @returns {Promise<object>} - Returns { success: boolean, newQuantity: number, message: string }
 */
async function IngredientRemove(SKU, Quantity, Unit) {
  return await IngredientUpdate(SKU, Quantity, Unit, 'remove');
}

/**
 * Internal function to update ingredient quantity (add or remove)
 * @param {string} SKU - The IngredientSKU to update
 * @param {number} Quantity - The quantity to add/subtract (in the provided unit)
 * @param {string} Unit - The unit of the provided quantity
 * @param {string} operation - Either 'add' or 'remove'
 * @returns {Promise<object>} - Returns { success: boolean, newQuantity: number, message: string }
 */
async function IngredientUpdate(SKU, Quantity, Unit, operation) {
  // Check access first
  if (!window.user) {
    return {
      success: false,
      newQuantity: 0,
      message: 'User not authenticated. Please call checkPermissions() first.'
    };
  }

  try {
    // Fetch the current ingredient data including the storage unit
    const { data: ingredient, error: fetchError } = await supabase
      .from('Ingredients')
      .select('IngredientSKU, Name, "Quantity", Unit')
      .eq('IngredientSKU', SKU)
      .single();

    if (fetchError || !ingredient) {
      return {
        success: false,
        newQuantity: 0,
        message: `Ingredient ${SKU} not found: ${fetchError?.message || 'Unknown error'}`
      };
    }

    // Get current quantity and storage unit
    const currentQuantity = parseFloat(ingredient['Quantity']) || 0;
    const storageUnit = ingredient.Unit;

    // Convert the provided quantity to the storage unit
    const convertedQuantity = convertUnits(Quantity, Unit, storageUnit);

    if (convertedQuantity === null) {
      return {
        success: false,
        newQuantity: currentQuantity,
        message: `Cannot convert from ${Unit} to ${storageUnit}. Supported units: lb, kg, oz, g, ml, L, fl oz, cups`
      };
    }

    // Calculate new quantity based on operation
    const quantityChange = operation === 'add' ? convertedQuantity : -convertedQuantity;
    const newQuantity = currentQuantity + quantityChange;

    // Update the ingredient quantity
    const { error: updateError } = await supabase
      .from('Ingredients')
      .update({ 'Quantity': newQuantity })
      .eq('IngredientSKU', SKU);

    if (updateError) {
      return {
        success: false,
        newQuantity: currentQuantity,
        message: `Failed to update ingredient: ${updateError.message}`
      };
    }

    // Log the change to IngredientLog
    const changeTime = new Date().toISOString();
    const updatedBy = window.user?.user_metadata?.display_name || 
                      window.user?.email || 
                      window.user?.id || 
                      CurrentUserDisplayName || 
                      null;

    const actionWord = operation === 'add' ? 'Added' : 'Removed';
    const logMessage = `${actionWord} ${Quantity} ${Unit} (${convertedQuantity.toFixed(3)} ${storageUnit})`;

    await supabase
      .from('IngredientLog')
      .insert({
        ChangeTime: changeTime,
        IngredientSKU: SKU,
        QuantityChanged: quantityChange,
        Updated_By: updatedBy,
        Log: logMessage
      });

    return {
      success: true,
      newQuantity: newQuantity,
      message: `Successfully ${operation === 'add' ? 'added' : 'removed'} ${Quantity} ${Unit} ${operation === 'add' ? 'to' : 'from'} ${ingredient.Name || SKU}. New quantity: ${newQuantity.toFixed(3)} ${storageUnit}`
    };

  } catch (error) {
    return {
      success: false,
      newQuantity: 0,
      message: `Error: ${error.message}`
    };
  }
}

/**
 * Converts a quantity from one unit to another
 * @param {number} quantity - The quantity to convert
 * @param {string} fromUnit - The unit to convert from
 * @param {string} toUnit - The unit to convert to
 * @returns {number|null} - The converted quantity, or null if conversion is not possible
 */
function convertUnits(quantity, fromUnit, toUnit) {
  // Normalize units to lowercase for comparison
  const fromUnitLower = String(fromUnit).toLowerCase().trim();
  const toUnitLower = String(toUnit).toLowerCase().trim();
  
  // If units are the same, no conversion needed
  if (fromUnitLower === toUnitLower) {
    return quantity;
  }
  
  // Weight conversion factors to grams
  const weightToGrams = {
    'lb': 453.592,
    'lbs': 453.592,
    'pound': 453.592,
    'pounds': 453.592,
    'kg': 1000,
    'kilogram': 1000,
    'kilograms': 1000,
    'oz': 28.3495,
    'ounce': 28.3495,
    'ounces': 28.3495,
    'g': 1,
    'gram': 1,
    'grams': 1
  };
  
  // Volume conversion factors to milliliters
  const volumeToMl = {
    'ml': 1,
    'milliliter': 1,
    'milliliters': 1,
    'l': 1000,
    'liter': 1000,
    'liters': 1000,
    'fl oz': 29.5735,
    'floz': 29.5735,
    'fluid ounce': 29.5735,
    'fluid ounces': 29.5735,
    'cup': 236.588,
    'cups': 236.588
  };
  
  // Check if both units are weight units
  const fromIsWeight = fromUnitLower in weightToGrams;
  const toIsWeight = toUnitLower in weightToGrams;
  
  // Check if both units are volume units
  const fromIsVolume = fromUnitLower in volumeToMl;
  const toIsVolume = toUnitLower in volumeToMl;
  
  // Can only convert within the same type (weight to weight, volume to volume)
  if (fromIsWeight && toIsWeight) {
    // Convert to grams as intermediate unit, then to target unit
    const grams = quantity * weightToGrams[fromUnitLower];
    const result = grams / weightToGrams[toUnitLower];
    return result;
  } else if (fromIsVolume && toIsVolume) {
    // Convert to milliliters as intermediate unit, then to target unit
    const ml = quantity * volumeToMl[fromUnitLower];
    const result = ml / volumeToMl[toUnitLower];
    return result;
  } else {
    // Cannot convert between weight and volume, or unit not recognized
    return null;
  }
}
