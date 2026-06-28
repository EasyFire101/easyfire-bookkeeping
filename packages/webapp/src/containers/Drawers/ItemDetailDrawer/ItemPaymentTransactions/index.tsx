import React from 'react';
import styled from 'styled-components';
import { Card } from '@/components';
import { ItemManuTransaction } from './utils';
import { ItemPaymentTransactionsContent as ItemPaymentTransactionContent } from './ItemPaymentTransactionContent';
import { useItemDetailDrawerContext } from '../ItemDetailDrawerProvider';

export function ItemPaymentTransactions() {
  const { value } = useItemDetailDrawerContext();

  return (
    <Card>
      <ItemTransactionsHeader />
      <ItemPaymentTransactionContent transactionType={value} />
    </Card>
  );
}

/**
 * Item transactions header.
 */
export function ItemTransactionsHeader() {
  const { setValue } = useItemDetailDrawerContext();

  const handleItemChange = (item: string) => {
    setValue(item);
  };
  return (
    <ItemTransactionsHeaderRoot>
      <ItemManuTransaction onChange={handleItemChange} />
    </ItemTransactionsHeaderRoot>
  );
}

export const ItemTransactionsHeaderRoot = styled.div`
  margin-bottom: 10px;
`;
