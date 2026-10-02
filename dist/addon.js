(()=>{'use strict';if(!globalThis.Grocyste?.available())return;
const ADDON_ID="recipe-scaling";const window=globalThis.Grocyste.compatWindow(ADDON_ID);const Grocy=window.Grocy;const fetch=window.fetch;
window.Grocyste.register({id:ADDON_ID,name:"Quantit\u00e9s et proportions",version:'1.0.0'});
const EXPECTED_SHOPPING_RANGE_GENERATION=window.Grocyste.configuration().instanceConfig?.shoppingRangeGeneration||null;
const MON_GROCY_SHARED_TIMER_ENTITY_ID=window.Grocyste.configuration().instanceConfig?.sharedTimerEntityId||0;


const STOP_TOKENS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'frais', 'fraiche', 'fraiches']);
const COUNT_UNITS = /^(?:oeuf|œuf|piece|pièce|gousse|tranche|sachet|paquet|pot|bocal|branche|feuille|tete|tête)$/iu;

// Display-only containments reviewed against the exact product and import evidence.
// They never enter Grocy's conversion graph or the stock/budget calculation.
const RECIPE_PACKAGE_MEASURES = new Map();
function configureRecipePackageMeasures(entries = []) {
  if(!Array.isArray(entries))throw new TypeError('Contenances invalides');
  const reviewed=new Map();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.productId) || entry.productId < 1 || typeof entry.name !== 'string' || !entry.name.trim() || !Number.isSafeInteger(entry.stock) || entry.stock < 1 || !Number.isFinite(entry.amount) || entry.amount <= 0 || !['g','ml'].includes(entry.unit) || !entry.proof) throw new TypeError('Contenance non prouvée');
    if(reviewed.has(entry.productId))throw new TypeError('Contenance dupliquée');
    reviewed.set(entry.productId, {...entry});
  }
  RECIPE_PACKAGE_MEASURES.clear();for(const [id,value] of reviewed)RECIPE_PACKAGE_MEASURES.set(id,value);
}

function scaleNumber(value, { nullable = false, nonNegative = false } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) throw new TypeError('Une quantité doit être un nombre fini');
  if (nonNegative ? parsed < 0 : parsed <= 0) throw new TypeError('Une quantité doit être positive');
  return parsed;
}

function scaleInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`${label} invalide`);
  return parsed;
}

function scaleBool(value) { return value === true || value === 1 || value === '1'; }
function scaleText(value) { const result = String(value ?? '').trim(); return result || null; }
function scaleUniqueMap(rows, key, label) {
  const map = new Map();
  for (const row of rows ?? []) {
    const id = scaleInteger(row?.[key], label);
    if (map.has(id)) throw new TypeError(`${label} dupliqué`);
    map.set(id, row);
  }
  return map;
}

function buildRecipeScaleInput({ recipeId, desiredServings = null, recipes = [], recipesPos = [], resolved = [], products = [], units = [] }) {
  const id = scaleInteger(recipeId, 'Identifiant recette');
  const matchingRecipes = (recipes ?? []).filter(row => Number(row?.id) === id);
  if (!matchingRecipes.length) throw new TypeError('Recette absente');
  if (matchingRecipes.length > 1) throw new TypeError('Identifiant recette dupliqué');
  const recipe = matchingRecipes[0];
  const baseServings = scaleNumber(recipe.base_servings);
  const nativeDesired = (() => { try { return scaleNumber(desiredServings); } catch { try { return scaleNumber(recipe.desired_servings); } catch { return baseServings; } } })();
  const productsById = scaleUniqueMap(products, 'id', 'Identifiant produit');
  const unitsById = scaleUniqueMap(units, 'id', 'Identifiant unité');
  const direct = (recipesPos ?? []).filter(row => Number(row.recipe_id) === id);
  scaleUniqueMap(direct, 'id', 'Identifiant position');
  const directIds = new Set(direct.map(row => Number(row.id)));
  // Planning views reuse native position IDs; select the current recipe before joining.
  const resolvedByPosition = scaleUniqueMap((resolved ?? []).filter(row =>
    (row.recipe_id == null || Number(row.recipe_id) === id) && directIds.has(Number(row.recipe_pos_id))), 'recipe_pos_id', 'Identifiant position résolue');

  const ingredients = direct.map(row => {
    const recipePosId = scaleInteger(row.id, 'Identifiant position');
    const productId = scaleInteger(row.product_id, 'Identifiant produit');
    const product = productsById.get(productId);
    const stockUnitIdCandidate = Number(product?.qu_id_stock);
    const unit = Number.isSafeInteger(stockUnitIdCandidate) ? unitsById.get(stockUnitIdCandidate) : null;
    const resolvedRow = resolvedByPosition.get(recipePosId);
    const onlyCheckSingleUnit = scaleBool(row.only_check_single_unit_in_stock);
    const rawAmount = Number(String(row.amount).replace(',', '.'));
    if (!Number.isFinite(rawAmount)) throw new TypeError('Une quantité doit être un nombre fini');
    const variableAmount = scaleText(row.variable_amount);
    let stockAmount = null;
    let missingAmount = null;
    if (resolvedRow) {
      stockAmount = scaleNumber(resolvedRow.stock_amount, { nullable: true, nonNegative: true });
      missingAmount = scaleNumber(resolvedRow.missing_amount, { nullable: true, nonNegative: true });
    }
    const packageMeasure = RECIPE_PACKAGE_MEASURES.get(productId);
    const measurement = packageMeasure && packageMeasure.name === product?.name?.trim() && packageMeasure.stock === stockUnitIdCandidate
      ? { amount: packageMeasure.amount, unit: packageMeasure.unit } : null;
    const sourceUnit = unitsById.get(Number(row.qu_id));
    return {
      recipePosId,
      productId,
      productName: scaleText(product?.name) ?? `Produit ${productId}`,
      baseStockAmount: !onlyCheckSingleUnit && rawAmount > 0 ? rawAmount : null,
      stockUnitId: unit ? Number(unit.id) : null,
      stockUnitLabel: unit ? scaleText(unit.name) : null,
      ...(unit?.name_plural ? { stockUnitPlural: scaleText(unit.name_plural) } : {}),
      variableAmount,
      stockAmount,
      missingAmount,
      stockCheckDisabled: scaleBool(row.not_check_stock_fulfillment),
      onlyCheckSingleUnit,
      ...(measurement ? { measurement } : {}),
      ...(onlyCheckSingleUnit && rawAmount > 0 && sourceUnit ? { baseSourceAmount: rawAmount, sourceUnitLabel: scaleText(sourceUnit.name), ...(sourceUnit.name_plural ? {sourceUnitPlural:scaleText(sourceUnit.name_plural)} : {}) } : {}),
    };
  });
  return { recipeId: id, baseServings, desiredServings: nativeDesired, ingredients };
}

function formatScaledNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError('Nombre fini requis');
  if (value !== 0 && Math.abs(value) < 0.000001) return value.toExponential(2).replace('.', ',');
  if (value !== 0 && Math.abs(value) < 0.001) return new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 3, useGrouping: false }).format(value);
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3, useGrouping: false }).format(value);
}

function pluralUnit(label, amount) {
  if (!label) return null;
  if (Math.abs(amount) === 1 || /s$/iu.test(label)) return label;
  return `${label}s`;
}

function scaleClosedRange(value) {
  const source = scaleText(value);
  if (!source || /(?:au goût|un peu|plus de|jusqu)/iu.test(source)) return null;
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(?:à|-|–)\s*(\d+(?:[.,]\d+)?)\s*([^\d]+?)\s*$/iu.exec(source);
  if (!match) return null;
  const min = Number(match[1].replace(',', '.'));
  const max = Number(match[2].replace(',', '.'));
  const unit = match[3].trim();
  if (!(min > 0 && max >= min && unit)) return null;
  return { min, max, unit };
}

function scaleMeasureUnit(label) {
  const value = scaleNormalize(label).replace(/[^\p{L}]/gu, '');
  if (/^(?:g|grammes?)$/u.test(value)) return { dimension: 'mass', factor: 1, unit: 'g' };
  if (/^(?:kg|kilogrammes?)$/u.test(value)) return { dimension: 'mass', factor: 1000, unit: 'kg' };
  if (/^(?:mg|milligrammes?)$/u.test(value)) return { dimension: 'mass', factor: 0.001, unit: 'mg' };
  if (/^(?:ml|millilitres?)$/u.test(value)) return { dimension: 'volume', factor: 1, unit: 'ml' };
  if (/^(?:cl|centilitres?)$/u.test(value)) return { dimension: 'volume', factor: 10, unit: 'cl' };
  if (/^(?:l|litres?)$/u.test(value)) return { dimension: 'volume', factor: 1000, unit: 'L' };
  return null;
}

function recipePivotMeasure(ingredient) {
  if (ingredient?.measurement) return { factor: ingredient.measurement.amount, unit: ingredient.measurement.unit };
  return { factor: 1, unit: scaleMeasureUnit(ingredient?.stockUnitLabel)?.unit ?? ingredient?.stockUnitLabel };
}

function scaleQuantityDisplay(amount, label, nativePlural = null) {
  const si = scaleMeasureUnit(label);
  if (si) return `${formatScaledNumber(amount * si.factor)} ${si.dimension === 'mass' ? 'g' : 'ml'}`;
  return `${formatScaledNumber(amount)} ${Math.abs(amount)!==1 && nativePlural ? nativePlural : pluralUnit(label, amount)}`;
}

function ingredientDisplay(ingredient, amount) {
  if (ingredient.measurement) return scaleQuantityDisplay(amount * ingredient.measurement.amount, ingredient.measurement.unit);
  const theoretical = COUNT_UNITS.test(ingredient.stockUnitLabel) && !Number.isInteger(amount) ? ' · théorique' : '';
  return `${scaleQuantityDisplay(amount, ingredient.stockUnitLabel, ingredient.stockUnitPlural)}${theoretical}`;
}

function scaledIngredient(ingredient, factor) {
  const range = scaleClosedRange(ingredient.variableAmount);
  if (range) {
    const min = range.min * factor; const max = range.max * factor;
    return { recipePosId: ingredient.recipePosId, productId: ingredient.productId, productName: ingredient.productName, quantityKind: 'range', min, max, unitLabel: range.unit, display: `${formatScaledNumber(min)} – ${formatScaledNumber(max)} ${range.unit}`, scalable: false, reason: 'Plage source mise à l’échelle' };
  }
  if (ingredient.variableAmount) return { recipePosId: ingredient.recipePosId, productId: ingredient.productId, productName: ingredient.productName, quantityKind: 'variable', min: null, max: null, unitLabel: ingredient.stockUnitLabel, display: ingredient.variableAmount, scalable: false, reason: 'Quantité variable conservée' };
  if (ingredient.onlyCheckSingleUnit && ingredient.baseSourceAmount && ingredient.sourceUnitLabel) {
    const amount = ingredient.baseSourceAmount * factor;
    const theoretical = COUNT_UNITS.test(ingredient.sourceUnitLabel) && !Number.isInteger(amount) ? ' · théorique' : '';
    return { recipePosId: ingredient.recipePosId, productId: ingredient.productId, productName: ingredient.productName, quantityKind: 'exact', min: amount, max: amount, unitLabel: ingredient.sourceUnitLabel, display: `${scaleQuantityDisplay(amount, ingredient.sourceUnitLabel, ingredient.sourceUnitPlural)}${theoretical}`, scalable: false, reason: 'Mesure de la recette ; conversion de stock non confirmée' };
  }
  if (ingredient.baseStockAmount !== null && ingredient.stockUnitId !== null && ingredient.stockUnitLabel) {
    const amount = ingredient.baseStockAmount * factor;
    return { recipePosId: ingredient.recipePosId, productId: ingredient.productId, productName: ingredient.productName, quantityKind: 'exact', min: amount, max: amount, unitLabel: ingredient.stockUnitLabel, display: ingredientDisplay(ingredient, amount), scalable: true, reason: null };
  }
  return { recipePosId: ingredient.recipePosId, productId: ingredient.productId, productName: ingredient.productName, quantityKind: 'unknown', min: null, max: null, unitLabel: ingredient.stockUnitLabel, display: 'Quantité inconnue', scalable: false, reason: 'Unité ou quantité non exploitable' };
}

function scaleRecipe(input, intent) {
  if (!input || !Array.isArray(input.ingredients)) throw new TypeError('Données recette invalides');
  let factor; let mode; let pivotRecipePosId = null;
  if (intent?.kind === 'servings') {
    mode = 'servings'; factor = Number(String(intent.servings).replace(',', '.')) / input.baseServings;
  } else if (intent?.kind === 'ingredient') {
    mode = 'ingredient';
    const pivot = input.ingredients.find(row => row.recipePosId === Number(intent.recipePosId));
    if (!pivot || pivot.baseStockAmount === null || pivot.stockUnitId === null || pivot.onlyCheckSingleUnit || pivot.variableAmount) throw new TypeError('Ingrédient pivot non canonique');
    factor = Number(String(intent.amount).replace(',', '.')) / pivot.baseStockAmount; pivotRecipePosId = pivot.recipePosId;
  } else throw new TypeError('Intent de calcul invalide');
  if (!Number.isFinite(factor) || factor < 0.01 || factor > 1000) throw new RangeError('Facteur hors bornes');
  return { mode, factor, theoreticalServings: input.baseServings * factor, pivotRecipePosId, ingredients: input.ingredients.map(row => scaledIngredient(row, factor)) };
}

function pivotAvailability(ingredient) {
  if (!ingredient || ingredient.onlyCheckSingleUnit || ingredient.variableAmount || ingredient.baseStockAmount === null || ingredient.stockUnitId === null) return { enabled: false, amount: null, reason: 'Unité de stock non canonique' };
  if (ingredient.stockAmount === null) return { enabled: false, amount: null, reason: 'Stock disponible inconnu' };
  if (ingredient.stockAmount <= 0) return { enabled: false, amount: null, reason: 'Stock disponible nul' };
  return { enabled: true, amount: ingredient.stockAmount, reason: null };
}

function scaledAvailabilityIngredients(input, result) {
  const scaled = new Map(result.ingredients.map(row => [row.recipePosId, row]));
  return input.ingredients.map(ingredient => {
    if (ingredient.stockCheckDisabled) return ingredient;
    const line = scaled.get(ingredient.recipePosId);
    let needed = line?.quantityKind === 'exact' && !ingredient.onlyCheckSingleUnit ? ingredient.baseStockAmount * result.factor : null;
    if (line?.quantityKind === 'range') {
      const from = scaleMeasureUnit(line.unitLabel);
      const to = scaleMeasureUnit(ingredient.measurement?.unit ?? ingredient.stockUnitLabel);
      if (from && to && from.dimension === to.dimension) needed = line.max * from.factor / to.factor / (ingredient.measurement?.amount ?? 1);
    }
    if (needed === null || !Number.isFinite(needed) || ingredient.stockAmount === null) return { ...ingredient, missingAmount: null };
    return { ...ingredient, missingAmount: Math.max(0, needed - ingredient.stockAmount) };
  });
}

function scaleNormalize(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('fr').replace(/œ/gu, 'oe'); }
function scaleWords(value) { return scaleNormalize(value).match(/[\p{L}\p{N}]+/gu) ?? []; }
function aliasesFor(ingredient) {
  const all = scaleWords(ingredient.productName);
  const first = all.find(token => token.length >= 3 && !STOP_TOKENS.has(token));
  const synonyms = /parmigiano reggiano/u.test(scaleNormalize(ingredient.productName)) ? ['parmesan'] : [];
  if (first === 'cassonade') synonyms.push('sucre');
  return [...new Set([scaleNormalize(ingredient.productName).replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), first,
    first?.endsWith('s') ? first.slice(0, -1) : first ? `${first}s` : null, ...synonyms].filter(value => value?.length >= 3))];
}

function scaleAliasStart(source, alias) {
  let offset = 0;
  while (offset <= source.length - alias.length) {
    const found = source.indexOf(alias, offset);
    if (found < 0) return -1;
    const before = found > 0 ? source[found - 1] : '';
    const after = found + alias.length < source.length ? source[found + alias.length] : '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return found;
    offset = found + 1;
  }
  return -1;
}

function scaleUnitKind(value) {
  const unit = scaleNormalize(value).replace(/[^\p{L}]/gu, '');
  if (/^(?:g|gramme|grammes)$/u.test(unit)) return 'gramme';
  if (/^(?:kg|kilogramme|kilogrammes)$/u.test(unit)) return 'kilogramme';
  if (/^(?:ml|millilitre|millilitres)$/u.test(unit)) return 'millilitre';
  if (/^(?:cl|centilitre|centilitres)$/u.test(unit)) return 'centilitre';
  if (/^(?:l|litre|litres)$/u.test(unit)) return 'litre';
  if (/^(?:oeuf|oeufs|œuf|œufs)$/u.test(unit)) return 'oeuf';
  return null;
}

function scaleTextOffsets(text) {
  let normalized = ''; const offsets = [];
  for (let i = 0; i < text.length; i++) {
    const value = scaleNormalize(text[i]);
    for (const character of value) { normalized += character; offsets.push(i); }
  }
  offsets.push(text.length);
  return { normalized, offsets };
}

function buildInstructionAnnotations(steps, input, result) {
  const output = new Map();
  const scaled = new Map(result.ingredients.map(row => [row.recipePosId, row]));
  const aliasCount = new Map();
  for (const ingredient of input.ingredients) for (const alias of aliasesFor(ingredient)) aliasCount.set(alias, (aliasCount.get(alias) ?? 0) + 1);
  for (const step of steps ?? []) {
    const { normalized, offsets } = scaleTextOffsets(step.text);
    const mentions = [];
    for (const ingredient of input.ingredients) {
      for (const alias of aliasesFor(ingredient).filter(value => aliasCount.get(value) === 1)) {
        let cursor = 0;
        while (cursor < normalized.length) {
          const localStart = scaleAliasStart(normalized.slice(cursor), alias);
          if (localStart < 0) break;
          const start = cursor + localStart;
          // Recheck the left boundary, because slicing can otherwise create a false one.
          if (start === 0 || !/[\p{L}\p{N}]/u.test(normalized[start - 1])) mentions.push({ ingredient, start: offsets[start], end: offsets[start + alias.length] });
          cursor = start + alias.length;
        }
      }
    }
    mentions.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const uniqueMentions = [];
    for (const mention of mentions) if (!uniqueMentions.some(item => mention.start < item.end && mention.end > item.start)) uniqueMentions.push(mention);
    const quantityPattern = /(?<![\p{L}\p{N}.,/])(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾])(?:\s*(?:à|–|-)\s*(\d+(?:[.,]\d+)?))?\s*(kilogrammes?|milligrammes?|grammes?|millilitres?|centilitres?|litres?|gousses?|têtes?|tetes?|oeufs?|œufs?|kg|mg|ml|cl|g|l)(?![\p{L}\p{N}])/giu;
    const quantities = Array.from(step.text.matchAll(quantityPattern));
    const candidates = [];
    for (const mention of uniqueMentions) {
      const ingredient = mention.ingredient, adapted = scaled.get(ingredient.recipePosId);
      if (!adapted) continue;
      const before = quantities.filter(q => q.index + q[0].length <= mention.start && /^\s*(?:de\s+|d['’]\s*)?$/iu.test(step.text.slice(q.index + q[0].length, mention.start))).at(-1);
      const counted = quantities.find(q => q.index < mention.start && q.index + q[0].length === mention.end);
      const after = quantities.find(q => q.index >= mention.end && /^\s*[:(]?\s*$/u.test(step.text.slice(mention.end, q.index)));
      const quantity = before ?? counted ?? after;
      let scaledLabel = adapted.display;
      if (quantity) {
        const raw = quantity[1].replace(/\s/gu, '').replace(',', '.');
        const pieces = raw.split('/');
        const value = ({ '½': 0.5, '¼': 0.25, '¾': 0.75 })[raw] ?? (pieces.length === 2 ? Number(pieces[0]) / Number(pieces[1]) : Number(raw));
        const sourceUnit = scaleMeasureUnit(quantity[3]);
        const expectedUnit = ingredient.onlyCheckSingleUnit ? ingredient.sourceUnitLabel : ingredient.measurement?.unit ?? ingredient.stockUnitLabel;
        const targetUnit = scaleMeasureUnit(expectedUnit);
        const compatible = sourceUnit && targetUnit ? sourceUnit.dimension === targetUnit.dimension
          : scaleNormalize(quantity[3]).replace(/s$/u, '') === scaleNormalize(expectedUnit).replace(/s$/u, '');
        if (!compatible || !Number.isFinite(value) || value <= 0) continue;
        // Scale the local measure, not the whole ingredient. This preserves additions made in stages.
        scaledLabel = scaleQuantityDisplay(value * result.factor, quantity[3]);
        if (quantity[2]) {
          const maximum = Number(quantity[2].replace(',', '.'));
          if (!(maximum >= value)) continue;
          const maximumLabel = scaleQuantityDisplay(maximum * result.factor, quantity[3]);
          const unitLabel = sourceUnit ? (sourceUnit.dimension === 'mass' ? 'g' : 'ml') : pluralUnit(quantity[3], maximum * result.factor);
          scaledLabel = `${scaledLabel.slice(0, -(scaledLabel.split(' ').at(-1).length + 1))} – ${maximumLabel.slice(0, -(maximumLabel.split(' ').at(-1).length + 1))} ${unitLabel}`;
        }
      } else if (/\b(?:reste|restant|restants|reserve|reservee|moitie|tiers|quart|facultativement|facultatif|facultative|facultatifs|facultatives|finition|brillance)\b/u.test(normalized.slice(Math.max(0, mention.start - 35), mention.end + 35))) {
        continue;
      }
      candidates.push({ recipePosId: ingredient.recipePosId, productName: ingredient.productName, sourceLabel: quantity?.[0] ?? null,
        scaledLabel, start: quantity ? quantity.index : mention.start, end: quantity ? quantity.index + quantity[0].length : mention.end,
        confidence: quantity ? 'exact' : 'name-only' });
    }
    candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const accepted = [];
    for (const candidate of candidates) if (!accepted.some(item => candidate.start < item.end && candidate.end > item.start)) accepted.push(candidate);
    if (accepted.length) output.set(step.id, accepted);
  }
  return output;
}

window.Grocyste.modules.recipeScaling=Object.freeze({buildRecipeScaleInput,formatScaledNumber,recipePivotMeasure,scaleRecipe,pivotAvailability,scaledAvailabilityIngredients,buildInstructionAnnotations,configureRecipePackageMeasures});
configureRecipePackageMeasures(window.Grocyste.configuration().instanceConfig?.recipePackageMeasures||[]);
})();
