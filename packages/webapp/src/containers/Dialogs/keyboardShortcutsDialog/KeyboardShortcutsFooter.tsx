// @ts-nocheck
import { Button, Intent } from '@blueprintjs/core';
import React from 'react';
import { FormattedMessage as T } from '@/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { compose } from '@/utils';

function KeyboardShortcutsFooterInner({
  // #withDialogActions
  closeDialog,
}) {
  const handleClose = () => {
    closeDialog('keyboard-shortcuts');
  };

  return (
    <div className={'dialog--keyboard-shortcuts__footer'}>
      <Button intent={Intent.PRIMARY} onClick={handleClose} small={true}>
        <T id={'oK_'} />
      </Button>
    </div>
  );
}

export const KeyboardShortcutsFooter = compose(withDialogActions)(
  KeyboardShortcutsFooterInner,
);
