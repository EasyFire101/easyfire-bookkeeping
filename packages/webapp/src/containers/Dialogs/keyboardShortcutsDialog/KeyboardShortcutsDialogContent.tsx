// @ts-nocheck
import React from 'react';
import { DialogContent } from '@/components';
import { ShortcutsTable } from '../../KeyboardShortcuts/ShortcutsTable';
import { KeyboardShortcutsFooter } from './KeyboardShortcutsFooter';

import '@/style/pages/keyboardShortcuts/KeyboardShortcutDialog.scss';

export function KeyboardShortcutsDialogContent() {
  return (
    <DialogContent name={'keyboard-shortcuts'}>
      <ShortcutsTable />
      <KeyboardShortcutsFooter />
    </DialogContent>
  );
}
