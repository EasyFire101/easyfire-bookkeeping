import React from 'react';
import { Tag, Intent } from '@blueprintjs/core';

import { T } from '@/components';
import type { Expense } from '@bigcapital/sdk-ts';

interface ExpenseDetailsStatusProps {
  expense: Expense | undefined;
}

/**
 * Expense details status.
 */
export function ExpenseDetailsStatus({ expense }: ExpenseDetailsStatusProps) {
  return expense?.isPublished ? (
    <Tag round={true} minimal={true}>
      <T id={'published'} />
    </Tag>
  ) : (
    <Tag round={true} intent={Intent.WARNING}>
      <T id={'draft'} />
    </Tag>
  );
}
