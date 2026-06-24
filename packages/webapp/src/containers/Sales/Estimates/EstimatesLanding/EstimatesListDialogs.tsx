import { EstimateBulkDeleteDialog } from '@/containers/Dialogs/Estimates/EstimateBulkDeleteDialog';
import { index as EstimatePdfPreviewDialog } from '@/containers/Dialogs/EstimatePdfPreviewDialog';
import { DialogsName } from '@/constants/dialogs';

export function EstimatesListDialogs() {
  return (
    <>
      <EstimateBulkDeleteDialog dialogName={DialogsName.EstimateBulkDelete} />
      <EstimatePdfPreviewDialog dialogName={DialogsName.EstimatePdfForm} />
    </>
  );
}
