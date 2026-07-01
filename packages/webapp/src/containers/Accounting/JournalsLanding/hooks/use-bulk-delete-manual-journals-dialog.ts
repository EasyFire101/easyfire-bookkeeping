import { DialogsName } from '@/constants/dialogs';
import { useValidateBulkDeleteManualJournals } from '@/hooks/query/manual-journals';
import { useBulkDeleteDialog } from '@/hooks/dialogs/useBulkDeleteDialog';

export const useBulkDeleteManualJournalsDialog = () => {
  const validateBulkDeleteMutation = useValidateBulkDeleteManualJournals();
  const {
    openBulkDeleteDialog,
    closeBulkDeleteDialog,
    isValidatingBulkDelete,
  } = useBulkDeleteDialog(
    DialogsName.ManualJournalBulkDelete,
    validateBulkDeleteMutation,
  );

  return {
    openBulkDeleteDialog,
    closeBulkDeleteDialog,
    isValidatingBulkDeleteManualJournals: isValidatingBulkDelete,
  };
};
