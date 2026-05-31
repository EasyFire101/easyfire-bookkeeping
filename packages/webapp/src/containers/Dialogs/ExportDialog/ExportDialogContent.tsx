// @ts-nocheck

import { ExportDialogForm } from './ExportDialogForm';
import { ExportFormInitialValues } from './type';

interface ExportDialogContentProps {
  initialValues?: ExportFormInitialValues;
}

/**
 * Account dialog content.
 */
export function ExportDialogContent({
  initialValues,
}: ExportDialogContentProps) {
  return <ExportDialogForm initialValues={initialValues} />;
}
