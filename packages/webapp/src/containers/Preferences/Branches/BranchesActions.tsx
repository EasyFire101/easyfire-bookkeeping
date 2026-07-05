// @ts-nocheck
import { Button, Intent } from '@blueprintjs/core';
import React from 'react';
import { FeatureCan, FormattedMessage as T, Icon } from '@/components';
import { Features } from '@/constants';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { compose } from '@/utils';

function BranchesActionsInner({
  //#ownProps
  openDialog,
}) {
  const handleClickNewBranche = () => {
    openDialog('branch-form');
  };

  return (
    <React.Fragment>
      <FeatureCan feature={Features.Branches}>
        <Button
          icon={<Icon icon="plus" iconSize={12} />}
          onClick={handleClickNewBranche}
          intent={Intent.PRIMARY}
        >
          <T id={'branches.label.new_branch'} />
        </Button>
      </FeatureCan>
    </React.Fragment>
  );
}

export const BranchesActions = compose(withDialogActions)(BranchesActionsInner);
