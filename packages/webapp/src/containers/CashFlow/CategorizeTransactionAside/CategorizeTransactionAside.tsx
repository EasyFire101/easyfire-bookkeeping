import { useEffect } from 'react';
import { Aside } from '@/components/Aside/Aside';
import { CategorizeTransactionTabs } from './CategorizeTransactionTabs';
import { withBankingActions } from '../withBankingActions';
import type { WithBankingActionsProps } from '../withBankingActions';
import { CategorizeTransactionTabsBoot } from './CategorizeTransactionTabsBoot';
import { withBanking } from '../withBanking';
import type { WithBankingProps } from '../withBanking';
import { compose } from '@/utils';

interface CategorizeTransactionAsideProps
  extends Pick<
      WithBankingActionsProps,
      | 'closeMatchingTransactionAside'
      | 'closeReconcileMatchingTransaction'
      | 'resetTransactionsToCategorizeSelected'
      | 'enableMultipleCategorization'
    >,
    Pick<WithBankingProps, 'selectedUncategorizedTransactionId'> {}

function CategorizeTransactionAsideRoot({
  // #withBankingActions
  closeMatchingTransactionAside,
  closeReconcileMatchingTransaction,
  resetTransactionsToCategorizeSelected,
  enableMultipleCategorization,

  // #withBanking
  selectedUncategorizedTransactionId,
}: CategorizeTransactionAsideProps) {
  useEffect(
    () => () => {
      // Close the reconcile matching form.
      closeReconcileMatchingTransaction();

      // Reset the selected transactions to categorize.
      resetTransactionsToCategorizeSelected();

      // Disable multi matching.
      enableMultipleCategorization(false);
    },
    [
      closeReconcileMatchingTransaction,
      resetTransactionsToCategorizeSelected,
      enableMultipleCategorization,
    ],
  );

  const handleClose = () => {
    closeMatchingTransactionAside();
  };
  // Cannot continue if there is no selected transaction.
  if (!selectedUncategorizedTransactionId) {
    return null;
  }
  return (
    <Aside title={'Categorize Bank Transaction'} onClose={handleClose}>
      <Aside.Body>
        <CategorizeTransactionTabsBoot
          uncategorizedTransactionIds={selectedUncategorizedTransactionId}
        >
          <CategorizeTransactionTabs />
        </CategorizeTransactionTabsBoot>
      </Aside.Body>
    </Aside>
  );
}

export const CategorizeTransactionAside = compose(
  withBankingActions,
  withBanking(({ selectedUncategorizedTransactionId }) => ({
    selectedUncategorizedTransactionId,
  })),
)(CategorizeTransactionAsideRoot);
