// @ts-nocheck
import { Popover, PopoverInteractionKind, Position } from '@blueprintjs/core';
import React from 'react';
import { AdvancedFilterDropdown } from './AdvancedFilterDropdown';

/**
 * Advanced filter popover.
 */
export function AdvancedFilterPopover({
  popoverProps = {},
  advancedFilterProps,
  children,
}: {
  popoverProps?: Record<string, any>;
  advancedFilterProps: Record<string, any>;
  children?: React.ReactNode;
}) {
  return (
    <Popover
      minimal={true}
      content={<AdvancedFilterDropdown {...advancedFilterProps} />}
      interactionKind={PopoverInteractionKind.CLICK}
      position={Position.BOTTOM_LEFT}
      canOutsideClickClose={true}
      modifiers={{
        offset: { offset: '0, 4' },
      }}
      {...popoverProps}
    >
      {children}
    </Popover>
  );
}
