// @ts-nocheck
import { Navbar } from '@blueprintjs/core';
import clsx from 'classnames';
import React from 'react';

interface DashboardActionsBarProps {
  children?: React.ReactNode;
}

export function DashboardActionsBar({
  className,
  children,
  name,
}: DashboardActionsBarProps) {
  return (
    <div
      className={clsx(
        {
          'dashboard__actions-bar': true,
          [`dashboard__actions-bar--${name}`]: !!name,
        },
        className,
      )}
    >
      <Navbar className="navbar--dashboard-actions-bar">{children}</Navbar>
    </div>
  );
}
