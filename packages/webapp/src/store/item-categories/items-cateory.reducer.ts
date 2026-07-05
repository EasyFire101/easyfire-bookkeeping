// @ts-nocheck
import { createReducer } from '@reduxjs/toolkit';
import { CATEGORY_DELETE, ITEMS_CATEGORY_LIST_SET } from '@/store/types';

const initialState = {
  tableState: {
    filterRoles: [],
  },
  categories: {},
  loading: false,
};

export default createReducer(initialState, {
  [ITEMS_CATEGORY_LIST_SET]: (state, action) => {
    const _categories = {};

    action.categories.forEach((category) => {
      _categories[category.id] = category;
    });
    state.categories = {
      ...state.categories,
      ..._categories,
    };
  },

  [CATEGORY_DELETE]: (state, action) => {
    const { id } = action.payload;
    const categories = { ...state.categories };

    if (typeof categories[id] !== 'undefined') {
      delete categories[id];
      state.categories = categories;
    }
  },
});

export const getCategoryId = (state, id) => {
  return state.itemCategories.categories[id] || {};
};
