// @ts-nocheck
import React from 'react';

import { ProjectInvoicingFormProvider } from './ProjectInvoicingFormProvider';
import { ProjectInvoicingForm } from './ProjectInvoicingForm';

/**
 * Project Invoicing form dialog content.
 * @returns
 */
export function ProjectInvoicingFormDialogContent({
  // #ownProps
  dialogName,
}) {
  return (
    <ProjectInvoicingFormProvider dialogName={dialogName}>
      <ProjectInvoicingForm />
    </ProjectInvoicingFormProvider>
  );
}
