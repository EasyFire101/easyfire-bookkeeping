import React from 'react';
import { connect } from 'react-redux';
import { Redirect } from 'react-router-dom';
import { compose } from '@/utils';
import { withAuthentication, WithAuthenticationProps } from '@/containers/Authentication/withAuthentication';
import { withOrganization, WithOrganizationProps } from '@/containers/Organization/withOrganization';

interface EnsureOrganizationIsNotReadyProps extends
  Pick<WithAuthenticationProps, 'currentOrganizationId'>,
  Pick<WithOrganizationProps, 'isOrganizationReady' | 'isOrganizationSetupCompleted'> {
  children: React.ReactNode;
  }

/**
 * Ensures organization is not ready.
 */
function EnsureOrganizationIsNotReady({
  children,

  // #withOrganization
  isOrganizationReady,
  isOrganizationSetupCompleted
}: EnsureOrganizationIsNotReadyProps) {
  return (isOrganizationReady && !isOrganizationSetupCompleted) ? (
    <Redirect to={{ pathname: '/' }} />
  ) : children;
}

export default compose(
  withAuthentication(({ currentOrganizationId }) => ({
    currentOrganizationId,
  })),
  connect<unknown, unknown, { currentOrganizationId: string | null }>(
    (_state, props) => ({
      organizationId: props.currentOrganizationId,
    }),
  ),
  withOrganization(({
    isOrganizationReady,
    isOrganizationSetupCompleted
  }) => ({
    isOrganizationReady,
    isOrganizationSetupCompleted
  })),
)(EnsureOrganizationIsNotReady);