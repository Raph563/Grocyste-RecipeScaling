import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('le bundle configure les contenances prouvées de la session avant son utilisation par RecipeLive',async()=>{
 const modules={},configuration={instanceConfig:{recipePackageMeasures:[{productId:99001,name:'GROCYSTE SYNTHETIQUE sachet',stock:99002,amount:125,unit:'g',proof:'Fixture lab reviewed only'}]}};
 const sdk={modules,available:()=>true,register(){},configuration:()=>configuration,compatWindow:()=>({Grocy:{},fetch(){},Grocyste:sdk})};
 runInNewContext(await readFile(new URL('../dist/addon.js',import.meta.url),'utf8'),{Grocyste:sdk});
 const model=modules.recipeScaling,fixture={recipeId:99003,recipes:[{id:99003,base_servings:2,desired_servings:2}],recipesPos:[{id:99004,recipe_id:99003,product_id:99001,amount:2,qu_id:99002}],products:[{id:99001,name:'GROCYSTE SYNTHETIQUE sachet',qu_id_stock:99002}],units:[{id:99002,name:'sachet',name_plural:'sachets'}],resolved:[]};
 const input=model.buildRecipeScaleInput(fixture);assert.equal(input.ingredients[0].measurement.amount,125);assert.equal(input.ingredients[0].measurement.unit,'g');
 const scaled=model.scaleRecipe(input,{kind:'servings',servings:4});assert.equal(scaled.factor,2);assert.equal(scaled.ingredients[0].min,4);assert.equal(scaled.ingredients[0].unitLabel,'sachet');assert.equal(scaled.ingredients[0].display,'500 g');assert.equal(model.recipePivotMeasure(input.ingredients[0]).factor,125);
 const liveConfig=JSON.parse(await readFile(new URL('../../Grocyste-RecipeLive/build-config.json',import.meta.url),'utf8'));
 assert.ok(!liveConfig.files.some(path=>path.endsWith('recipe-scale-model.mjs')));assert.match(liveConfig.prefix,/window\.Grocyste\.modules\.recipeScaling/);
 const changed=structuredClone(fixture);changed.products[0].name+=' changed';assert.equal(model.buildRecipeScaleInput(changed).ingredients[0].measurement,undefined);
 const drift=structuredClone(fixture);drift.products[0].qu_id_stock=99005;drift.units.push({id:99005,name:'pot'});assert.equal(model.buildRecipeScaleInput(drift).ingredients[0].measurement,undefined);
});
