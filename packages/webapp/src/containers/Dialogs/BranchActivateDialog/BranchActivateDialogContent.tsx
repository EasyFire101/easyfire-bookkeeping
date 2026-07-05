// @ts-nocheck
import React from 'react';
import { BranchActivateForm } from './BranchActivateForm';
import { BranchActivateFormProvider } from './BranchActivateFormProvider';

export function BranchActivateDialogContent({
  // #ownProps
  dialogName,
}) {
  return (
    <BranchActivateFormProvider dialogName={dialogName}>
      <BranchActivateForm />
    </BranchActivateFormProvider>
  );
}
