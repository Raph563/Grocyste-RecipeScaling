import test from 'node:test';
import assert from 'node:assert/strict';
import {configureRecipePackageMeasures,buildRecipeScaleInput} from '../src/ui/recipe-scale-model.mjs';
const tables={recipeId:1,recipes:[{id:1,base_servings:4}],recipesPos:[{id:1,recipe_id:1,product_id:25,amount:1}],products:[{id:25,name:'Produit boîte',qu_id_stock:35}],units:[{id:35,name:'Boîte'}]};
test('aucune contenance privée présumée ; nom et unité doivent toujours correspondre',()=>{
  configureRecipePackageMeasures([]);assert.equal(buildRecipeScaleInput(tables).ingredients[0].measurement,undefined);
  configureRecipePackageMeasures([{productId:25,name:'Produit boîte',stock:35,amount:500,unit:'g',proof:'reviewed-fixture'}]);
  assert.deepEqual(buildRecipeScaleInput(tables).ingredients[0].measurement,{amount:500,unit:'g'});
  assert.equal(buildRecipeScaleInput({...tables,products:[{...tables.products[0],name:'Autre produit'}]}).ingredients[0].measurement,undefined);
  assert.equal(buildRecipeScaleInput({...tables,products:[{...tables.products[0],qu_id_stock:36}]}).ingredients[0].measurement,undefined);
  configureRecipePackageMeasures([]);
});
test('configuration sans preuve ou dupliquée est refusée entièrement',()=>{
  const value={productId:25,name:'Produit boîte',stock:35,amount:500,unit:'g',proof:'reviewed-fixture'};configureRecipePackageMeasures([]);
  assert.throws(()=>configureRecipePackageMeasures([value,value]),/dupliquée/);
  assert.equal(buildRecipeScaleInput(tables).ingredients[0].measurement,undefined);
  assert.throws(()=>configureRecipePackageMeasures([{...value,proof:''}]),/prouvée/);
});
