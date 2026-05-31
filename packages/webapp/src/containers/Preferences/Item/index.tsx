// @ts-nocheck
import React from 'react';
import { ItemPreferencesFormPage } from './ItemPreferencesFormPage';
import { ItemPreferencesFormProvider } from './ItemPreferencesFormProvider';

/**
 * items preferences.
 */
export function ItemsPreferences() {
  return (
    <ItemPreferencesFormProvider>
      <ItemPreferencesFormPage />
    </ItemPreferencesFormProvider>
  );
}
