// @ts-nocheck
import { connect } from 'react-redux';
import { getDialogPayload } from '@/store/dashboard/dashboard.reducer';
import { getUserDetails } from '@/store/users/users.reducer';

export const mapStateToProps = (state, props) => {
  const dialogPayload = getDialogPayload(state, 'user-form');

  return {
    dialogName: 'user-form',
    payload: { action: 'new', id: null },
    userDetails:
      dialogPayload.action === 'edit'
        ? getUserDetails(state, dialogPayload.user.id)
        : {},
  };
};

export const UserFormDialogConnector = connect(mapStateToProps, null);
