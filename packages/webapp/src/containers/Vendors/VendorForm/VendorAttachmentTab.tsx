// @ts-nocheck
import React from 'react';
import { Dragzone, FormattedMessage as T } from '@/components';

/**
 * Vendor Attachment Tab.
 */
export function VendorAttachmentTab() {
  return (
    <div>
      <Dragzone
        initialFiles={[]}
        onDrop={null}
        onDeleteFile={[]}
        hint={<T id={'attachments_maximum'} />}
      />
    </div>
  );
}
