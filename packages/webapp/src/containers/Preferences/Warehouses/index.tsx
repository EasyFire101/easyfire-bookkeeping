// @ts-nocheck
import React from 'react';
import { Warehouses } from './Warehouses';
import { WarehousesProvider } from './WarehousesProvider';

/**
 * Warehouses Preferences.
 * @returns
 */
export function WarehousesPerences() {
  return (
    <WarehousesProvider>
      <Warehouses />
    </WarehousesProvider>
  );
}
