import React from 'react';
import PropTypes from 'prop-types';
import type { ButtonProps } from '../types';

export function Button(props: ButtonProps) {
  return (
    <button type="button" onClick={props.onClick}>
      {props.label}
    </button>
  );
}

// Rule 2: react-19-defaultprops-removal — defaultProps on a function component.
Button.defaultProps = {
  label: 'Click me',
};

// Rule 5: react-19-proptypes-removal — propTypes on a function component.
Button.propTypes = {
  label: PropTypes.string,
  onClick: PropTypes.func,
};
