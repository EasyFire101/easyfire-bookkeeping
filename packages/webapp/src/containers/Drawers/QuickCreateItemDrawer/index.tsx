// @ts-nocheck
import React from 'react';
import { Drawer, DrawerSuspense } from '@/components';
import { withDrawers } from '@/containers/Drawer/withDrawers';
import { compose } from '@/utils';

const QuickCretaeItemDrawerContent = React.lazy(() =>
  import('./QuickCreateItemDrawerContent').then((m) => ({
    default: m.QuickCreateItemDrawerContent,
  })),
);

/**
 * Quick create item.
 */
function QuickCreateItemDrawer({
  // #ownProps
  name,

  // #withDrawer
  isOpen,
  payload,
}) {
  return (
    <Drawer
      isOpen={isOpen}
      name={name}
      style={{ minWidth: '800px', maxWidth: '1000px' }}
      size={'72%'}
      payload={payload}
    >
      <DrawerSuspense>
        <QuickCretaeItemDrawerContent itemName={payload.name} />
      </DrawerSuspense>
    </Drawer>
  );
}

export const index = compose(withDrawers())(QuickCreateItemDrawer);
