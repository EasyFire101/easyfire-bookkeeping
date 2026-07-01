import React from 'react';
import { Menu, MenuItem } from '@blueprintjs/core';
import { safeCallback } from '@/utils';
import { Icon } from '@/components';
import type { ExcludedTransactionRow } from './_utils';

interface ActionsMenuProps {
  row: { original: ExcludedTransactionRow };
  payload: { onRestore: (transaction: ExcludedTransactionRow) => void };
}

export function ActionsMenu({
  payload: { onRestore },
  row: { original },
}: ActionsMenuProps) {
  return (
    <Menu>
      <MenuItem
        text={'Restore'}
        icon={<Icon icon="redo" iconSize={16} />}
        onClick={safeCallback(onRestore, original)}
      />
    </Menu>
  );
}
