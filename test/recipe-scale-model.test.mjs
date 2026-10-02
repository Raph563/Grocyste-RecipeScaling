import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInstructionAnnotations,
  buildRecipeScaleInput,
  formatScaledNumber,
  pivotAvailability,
  scaleRecipe,
} from '../src/ui/recipe-scale-model.mjs';

function tables() {
  return {
    recipes: [{ id: '27', base_servings: '4', desired_servings: '6' }],
    recipesPos: [
      { id: '11', recipe_id: '27', product_id: '271', amount: '250', qu_id: '4', variable_amount: '', only_check_single_unit_in_stock: '0', not_check_stock_fulfillment: '0' },
      { id: '12', recipe_id: '27', product_id: '336', amount: '2', qu_id: '49', variable_amount: '', only_check_single_unit_in_stock: '0', not_check_stock_fulfillment: '0' },
      { id: '13', recipe_id: '27', product_id: '38', amount: '0', qu_id: '4', variable_amount: '1 pincée', only_check_single_unit_in_stock: '0', not_check_stock_fulfillment: '1' },
      { id: '14', recipe_id: '99', product_id: '271', amount: '999', qu_id: '4', variable_amount: '', only_check_single_unit_in_stock: '0', not_check_stock_fulfillment: '0' },
    ],
    resolved: [
      { recipe_pos_id: '12', stock_amount: '8', missing_amount: '0', need_fulfilled: '1' },
      { recipe_pos_id: '11', stock_amount: '1000', missing_amount: '0', need_fulfilled: '1' },
      { recipe_pos_id: '13', stock_amount: '0', missing_amount: '1', need_fulfilled: '0' },
    ],
    products: [
      { id: '336', name: 'Œufs frais', qu_id_stock: '49' },
      { id: '271', name: 'Farine de blé', qu_id_stock: '4' },
      { id: '38', name: 'Sel fin de mer iodé', qu_id_stock: '4' },
    ],
    units: [{ id: '49', name: 'Œuf' }, { id: '4', name: 'Gramme' }],
  };
}

test('joint les tables par identifiants et conserve zéro comme stock valide', () => {
  const input = buildRecipeScaleInput({ recipeId: 27, ...tables() });
  assert.deepEqual(input, {
    recipeId: 27,
    baseServings: 4,
    desiredServings: 6,
    ingredients: [
      { recipePosId: 11, productId: 271, productName: 'Farine de blé', baseStockAmount: 250, stockUnitId: 4, stockUnitLabel: 'Gramme', variableAmount: null, stockAmount: 1000, missingAmount: 0, stockCheckDisabled: false, onlyCheckSingleUnit: false },
      { recipePosId: 12, productId: 336, productName: 'Œufs frais', baseStockAmount: 2, stockUnitId: 49, stockUnitLabel: 'Œuf', variableAmount: null, stockAmount: 8, missingAmount: 0, stockCheckDisabled: false, onlyCheckSingleUnit: false },
      { recipePosId: 13, productId: 38, productName: 'Sel fin de mer iodé', baseStockAmount: null, stockUnitId: 4, stockUnitLabel: 'Gramme', variableAmount: '1 pincée', stockAmount: 0, missingAmount: 1, stockCheckDisabled: true, onlyCheckSingleUnit: false },
    ],
  });
});

test('priorise la saisie de portions valide puis Grocy puis la base', () => {
  assert.equal(buildRecipeScaleInput({ recipeId: 27, desiredServings: '8', ...tables() }).desiredServings, 8);
  const invalid = tables(); invalid.recipes[0].desired_servings = 'nan';
  assert.equal(buildRecipeScaleInput({ recipeId: 27, desiredServings: '0', ...invalid }).desiredServings, 4);
});

test('calcule depuis les portions et conserve les pièces fractionnaires théoriques', () => {
  const input = buildRecipeScaleInput({ recipeId: 27, ...tables() });
  const result = scaleRecipe(input, { kind: 'servings', servings: 5 });
  assert.equal(result.factor, 1.25);
  assert.equal(result.theoreticalServings, 5);
  assert.equal(result.ingredients[0].display, '312,5 g');
  assert.equal(result.ingredients[1].display, '2,5 Œufs · théorique');
  assert.equal(result.ingredients[2].quantityKind, 'variable');
  assert.match(result.ingredients[2].display, /1 pincée/);
});

test('calcule depuis toute la farine et refuse facteurs ou pivots invalides', () => {
  const input = buildRecipeScaleInput({ recipeId: 27, ...tables() });
  const result = scaleRecipe(input, { kind: 'ingredient', recipePosId: 11, amount: 1000 });
  assert.equal(result.factor, 4);
  assert.equal(result.theoreticalServings, 16);
  assert.equal(result.pivotRecipePosId, 11);
  assert.equal(result.ingredients[1].display, '8 Œufs');
  assert.throws(() => scaleRecipe(input, { kind: 'ingredient', recipePosId: 13, amount: 1 }), /pivot/iu);
  assert.throws(() => scaleRecipe(input, { kind: 'servings', servings: 0 }), /facteur/iu);
  assert.throws(() => scaleRecipe(input, { kind: 'servings', servings: 4001 }), /facteur/iu);
});

test('n’active le stock disponible que dans l’unité canonique', () => {
  const input = buildRecipeScaleInput({ recipeId: 27, ...tables() });
  assert.deepEqual(pivotAvailability(input.ingredients[0]), { enabled: true, amount: 1000, reason: null });
  assert.deepEqual(pivotAvailability({ ...input.ingredients[0], stockAmount: 0 }), { enabled: false, amount: null, reason: 'Stock disponible nul' });
  assert.deepEqual(pivotAvailability({ ...input.ingredients[0], stockAmount: null }), { enabled: false, amount: null, reason: 'Stock disponible inconnu' });
  assert.deepEqual(pivotAvailability({ ...input.ingredients[0], onlyCheckSingleUnit: true }), { enabled: false, amount: null, reason: 'Unité de stock non canonique' });
});

test('gère plages, inconnus et nombres français sans muter les données', () => {
  const input = buildRecipeScaleInput({ recipeId: 27, ...tables() });
  const before = structuredClone(input);
  input.ingredients.push({ recipePosId: 15, productId: 1, productName: 'Eau', baseStockAmount: null, stockUnitId: 18, stockUnitLabel: 'Millilitre', variableAmount: '200 à 250 ml', stockAmount: null, missingAmount: null, stockCheckDisabled: false, onlyCheckSingleUnit: true });
  input.ingredients.push({ recipePosId: 16, productId: 2, productName: 'Mystère', baseStockAmount: null, stockUnitId: null, stockUnitLabel: null, variableAmount: null, stockAmount: null, missingAmount: null, stockCheckDisabled: false, onlyCheckSingleUnit: false });
  const result = scaleRecipe(input, { kind: 'servings', servings: 8 });
  assert.deepEqual({ kind: result.ingredients[3].quantityKind, min: result.ingredients[3].min, max: result.ingredients[3].max, display: result.ingredients[3].display }, { kind: 'range', min: 400, max: 500, display: '400 – 500 ml' });
  assert.equal(result.ingredients[4].quantityKind, 'unknown');
  assert.equal(formatScaledNumber(1.23456), '1,235');
  assert.deepEqual(input.ingredients.slice(0, 3), before.ingredients);
});

test('annote les ingrédients uniques et protège temps, température et ambiguïtés', () => {
  const input = buildRecipeScaleInput({ recipeId: 27, ...tables() });
  const result = scaleRecipe(input, { kind: 'servings', servings: 8 });
  const annotations = buildInstructionAnnotations([
    { id: 'recipe-step-1', text: 'Mélanger 250 g de farine pendant 10 min à 180 °C.' },
    { id: 'recipe-step-2', text: 'Ajouter les œufs puis le sel.' },
  ], input, result);
  assert.equal(annotations.get('recipe-step-1')[0].confidence, 'exact');
  assert.equal(annotations.get('recipe-step-1')[0].sourceLabel, '250 g');
  assert.equal(annotations.get('recipe-step-1')[0].scaledLabel, '500 g');
  assert.deepEqual(annotations.get('recipe-step-2').map(item => item.productName), ['Œufs frais', 'Sel fin de mer iodé']);
  assert.doesNotMatch(annotations.get('recipe-step-1')[0].scaledLabel, /10|180/u);
  const ambiguous = buildRecipeScaleInput({ recipeId: 27, ...tables() });
  ambiguous.ingredients.push({ ...ambiguous.ingredients[0], recipePosId: 99, productId: 999, productName: 'Farine complète' });
  assert.equal(buildInstructionAnnotations([{ id: 'x', text: 'Ajouter la farine.' }], ambiguous, scaleRecipe(ambiguous, { kind: 'servings', servings: 4 })).get('x')?.length ?? 0, 0);
  const withGarlic = structuredClone(input);
  withGarlic.ingredients.push({ ...input.ingredients[0], recipePosId: 98, productId: 998, productName: 'Ail' });
  const worktop = buildInstructionAnnotations([{ id: 'worktop', text: 'Déposer la farine sur le plan de travail.' }], withGarlic, scaleRecipe(withGarlic, { kind: 'servings', servings: 4 }));
  assert.deepEqual(worktop.get('worktop').map(item => item.productName), ['Farine de blé']);
  const wrongUnit = buildInstructionAnnotations([{ id: 'wrong-unit', text: 'Mélanger 250 ml de farine.' }], input, result);
  assert.equal(wrongUnit.get('wrong-unit')?.length ?? 0, 0);
});

test('rejette doublons et nombres non finis, mais garde une ligne sans unité inconnue', () => {
  const duplicate = tables(); duplicate.recipesPos.push({ ...duplicate.recipesPos[0] });
  assert.throws(() => buildRecipeScaleInput({ recipeId: 27, ...duplicate }), /dupliqué/iu);
  const nonFinite = tables(); nonFinite.recipesPos[0].amount = 'Infinity';
  assert.throws(() => buildRecipeScaleInput({ recipeId: 27, ...nonFinite }), /fini/iu);
  const missingUnit = tables(); missingUnit.products[1].qu_id_stock = '999';
  const input = buildRecipeScaleInput({ recipeId: 27, ...missingUnit });
  assert.equal(input.ingredients[0].stockUnitId, null);
  assert.equal(scaleRecipe(input, { kind: 'servings', servings: 4 }).ingredients[0].quantityKind, 'unknown');
});

test('ignore les recettes techniques Grocy à identifiant négatif', () => {
  const data = { recipeId: 27, ...tables() };
  data.recipes.unshift({ id: -1, name: 'Vue planning interne', base_servings: 1, desired_servings: 1 });
  data.resolved.unshift({ recipe_pos_id: -99, stock_amount: 0, missing_amount: 0 });
  data.resolved.unshift({ recipe_id: -70, recipe_pos_id: '11', stock_amount: 99, missing_amount: 99 });
  data.resolved.unshift({ recipe_id: 99, recipe_pos_id: '12', stock_amount: 99, missing_amount: 99 });
  const input = buildRecipeScaleInput(data);
  assert.equal(input.recipeId, data.recipeId);
  assert.ok(input.ingredients.length > 0);
  assert.equal(input.ingredients[0].stockAmount, 1000);
  assert.equal(input.ingredients[1].stockAmount, 8);
});
