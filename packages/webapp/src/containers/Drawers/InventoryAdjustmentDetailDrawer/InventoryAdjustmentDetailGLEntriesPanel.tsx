import React from 'react';
import styled from 'styled-components';
import { Card } from '@/components';
import { useTransactionsByReference } from '@/hooks/query';
import { useInventoryAdjustmentDrawerContext } from './InventoryAdjustmentDrawerProvider';
import {
  AmountDisplayedBaseCurrencyMessage,
  JournalEntriesTable,
} from '../../JournalEntriesTable/JournalEntriesTable';

/**
 * Inventory adjustment detail GL entries panel.
 */
export function InventoryAdjustmentDetailGLEntriesPanel() {
  const { inventoryId } = useInventoryAdjustmentDrawerContext();

  const { data, isLoading: isTransactionLoading } = useTransactionsByReference(
    {
      referenceId: inventoryId as number,
      referenceType: 'InventoryAdjustment',
    },
    { enabled: !!inventoryId },
  );
  const transactions = data?.transactions ?? [];

  return (
    <InventoryAdjustmentGLEntriesRoot>
      <AmountDisplayedBaseCurrencyMessage />
      <JournalEntriesTable
        loading={isTransactionLoading}
        transactions={transactions}
      />
    </InventoryAdjustmentGLEntriesRoot>
  );
}

const InventoryAdjustmentGLEntriesRoot = styled(Card)``;
