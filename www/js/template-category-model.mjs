function clean(value) {
  return String(value || '').trim();
}

export function normalizeTemplateCategories(input = []) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((category, index) => ({
      id: clean(category?.id),
      name: clean(category?.name),
      order: Number.isFinite(Number(category?.order)) ? Number(category.order) : index,
    }))
    .filter((category) => {
      if (!category.id || !category.name || seen.has(category.id)) return false;
      seen.add(category.id);
      return true;
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'))
    .map((category, order) => ({ ...category, order }));
}

export function normalizeTemplateCategoryId(template, categories) {
  const id = clean(template?.categoryId);
  return normalizeTemplateCategories(categories).some((category) => category.id === id) ? id : '';
}

export function removeTemplateCategory({ categoryId, categories, templates }) {
  const id = clean(categoryId);
  return {
    categories: normalizeTemplateCategories(categories)
      .filter((category) => category.id !== id)
      .map((category, order) => ({ ...category, order })),
    templates: (Array.isArray(templates) ? templates : []).map((template) => (
      clean(template?.categoryId) === id ? { ...template, categoryId: '' } : template
    )),
  };
}
