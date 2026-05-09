import Toast from 'react-native-toast-message';
import { toast } from '../lib/toast';

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

describe('toast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('error() calls Toast.show with type "error"', () => {
    toast.error('Something went wrong');
    expect(Toast.show).toHaveBeenCalledWith({
      type: 'error',
      text1: 'Something went wrong',
    });
  });

  it('success() calls Toast.show with type "success"', () => {
    toast.success('All good');
    expect(Toast.show).toHaveBeenCalledWith({
      type: 'success',
      text1: 'All good',
    });
  });
});
