// @ts-nocheck
import classNames from 'classnames';
import React from 'react';
import { CLASSES } from '@/constants/classes';

/**
 * Dashboard content table.
 */
export function DashboardContentTable({ children }) {
  return (
    <div className={classNames(CLASSES.DASHBOARD_DATATABLE)}>{children}</div>
  );
}
