// @ts-nocheck
import React, { createContext, useContext, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { useInviteMetaByToken, useAuthInviteAccept } from '@/hooks/query';
import { InviteAcceptLoading } from './components';

const InviteAcceptContext = createContext();

/**
 * Invite accept provider.
 */
function InviteAcceptProvider({ token, ...props }) {
  // Invite meta by token.
  const {
    data: inviteMeta,
    error: inviteMetaError,
    isError: isInviteMetaError,
    isFetching: isInviteMetaLoading,
  } = useInviteMetaByToken(token, { retry: false });

  // Invite accept mutate.
  const { mutateAsync: inviteAcceptMutate } = useAuthInviteAccept({
    retry: false,
  });
  // History context.
  const history = useHistory();

  useEffect(() => {
    if (inviteMetaError) { history.push('/auth/login'); }
  }, [history, inviteMetaError]);

  // Transform the backend response to match frontend expectations.
  const transformedInviteMeta = inviteMeta
    ? {
        email: inviteMeta.inviteToken?.email,
        organizationName: inviteMeta.orgName,
      }
    : null;

  // Provider payload.
  const provider = {
    token,
    inviteMeta: transformedInviteMeta,
    inviteMetaError,
    isInviteMetaError,
    isInviteMetaLoading,
    inviteAcceptMutate,
  };

  if (inviteMetaError) {
    return null;
  }

  return (
    <InviteAcceptLoading isLoading={isInviteMetaLoading}>
      <InviteAcceptContext.Provider value={provider} {...props} />
    </InviteAcceptLoading>
  );
}

const useInviteAcceptContext = () => useContext(InviteAcceptContext);

export { InviteAcceptProvider, useInviteAcceptContext };
