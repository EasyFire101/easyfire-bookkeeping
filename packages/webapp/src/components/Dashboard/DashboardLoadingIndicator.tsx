// @ts-nocheck
import React from 'react';
import BigcapitalLoading from './BigcapitalLoading';
import { Choose } from '@/components';

/**
 * Dashboard loading indicator.
 */
export default function DashboardLoadingIndicator({
  isLoading = false,
  className,
  children,
}) {
  return (
    <Choose>
      <Choose.When condition={isLoading}>
        <BigcapitalLoading />
      </Choose.When>

      <Choose.Otherwise>{children}</Choose.Otherwise>
    </Choose>
  );
}
