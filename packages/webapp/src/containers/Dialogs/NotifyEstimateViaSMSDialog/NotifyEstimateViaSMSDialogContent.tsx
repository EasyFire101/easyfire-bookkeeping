// @ts-nocheck
import React from 'react';
import { NotifyEstimateViaSMSForm } from './NotifyEstimateViaSMSForm';
import { NotifyEstimateViaSMSFormProvider } from './NotifyEstimateViaSMSFormProvider';

export function NotifyEstimateViaSMSDialogContent({
  // #ownProps
  dialogName,
  estimate,
}) {
  return (
    <NotifyEstimateViaSMSFormProvider
      estimateId={estimate}
      dialogName={dialogName}
    >
      <NotifyEstimateViaSMSForm />
    </NotifyEstimateViaSMSFormProvider>
  );
}
