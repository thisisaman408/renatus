import React, { useRef, forwardRef, type Ref } from 'react';

interface InputProps {
  placeholder: string;
}

// forwardRef stays compatible across React 18 → 19; what trips the rule here
// is the internal useRef() call without an argument (Rule 1).
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  props,
  ref: Ref<HTMLInputElement>,
) {
  // Rule 1: react-19-useref-initial-arg — useRef() with no argument.
  const internalRef = useRef();
  void internalRef;

  return <input placeholder={props.placeholder} ref={ref} />;
});
