import { connect, MapStateToProps } from 'react-redux';
import { getExpenseByIdFactory } from '@/store/expenses/expenses.selectors';
import { ApplicationState } from '@/store/reducers';

export interface WithExpenseDetailProps {
  expense: ReturnType<ReturnType<typeof getExpenseByIdFactory>>;
}

interface OwnProps {
  expenseId?: number | string;
}

export const withExpenseDetail = () => {
  const getExpenseById = getExpenseByIdFactory();

  const mapStateToProps: MapStateToProps<
    WithExpenseDetailProps,
    OwnProps,
    ApplicationState
  > = (state, props) => ({
    expense: getExpenseById(state, props),
  });
  return connect(mapStateToProps);
};
