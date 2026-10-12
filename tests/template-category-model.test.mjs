import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTemplateCategories,
  normalizeTemplateCategoryId,
  removeTemplateCategory,
} from '../www/js/template-category-model.mjs';

test('normalizes categories and keeps only unique non-empty ids', () => {
  assert.deepEqual(normalizeTemplateCategories([
    { id: 'sales', name: '営業', order: 2 },
    { id: 'sales', name: '重複', order: 1 },
    { id: '', name: '無効' },
    { id: 'thanks', name: 'お礼', order: 0 },
  ]), [
    { id: 'thanks', name: 'お礼', order: 0 },
    { id: 'sales', name: '営業', order: 1 },
  ]);
});

test('legacy templates without category remain uncategorized', () => {
  assert.equal(normalizeTemplateCategoryId({ id: 't1' }, [{ id: 'sales', name: '営業' }]), '');
});

test('removing a category preserves templates as uncategorized', () => {
  const result = removeTemplateCategory({
    categoryId: 'sales',
    categories: [{ id: 'sales', name: '営業', order: 0 }],
    templates: [{ id: 't1', categoryId: 'sales' }, { id: 't2', categoryId: '' }],
  });
  assert.deepEqual(result.categories, []);
  assert.deepEqual(result.templates, [{ id: 't1', categoryId: '' }, { id: 't2', categoryId: '' }]);
});
