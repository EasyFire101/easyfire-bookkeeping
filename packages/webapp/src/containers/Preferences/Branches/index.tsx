// @ts-nocheck
import React from 'react';

import { BranchesProvider } from './BranchesProvider';
import { Branches } from './Branches';

/**
 * Branches .
 */
export function BranchesPreferences() {
  return (
    <BranchesProvider>
      <Branches />
    </BranchesProvider>
  );
}
