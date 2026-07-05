// @ts-nocheck
import { connect } from 'react-redux';
import { getDialogPayload } from '@/store/dashboard/dashboard.reducer';
import { getUserDetails } from '@/store/users/users.reducer';

export const mapStateToProps = (state, props) => {
  const dialogPayload = getDialogPayload(state, 'userList-form');

  return {
    name: 'userList-form',
    payload: { action: 'new', id: null },
    userDetails:
      dialogPayload.action === 'edit'
        ? getUserDetails(state, dialogPayload.user.id)
        : {},
    editUser:
      dialogPayload && dialogPayload.action === 'edit'
        ? state.users.list.results[dialogPayload.user.id]
        : {},
  };
};

export const UsersListDialogConnector = connect(mapStateToProps, null);
