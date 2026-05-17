// @ts-nocheck
// Tailwind v3 modal — exercises Rule 2 (text-opacity-*) and Rule 3
// (shadow-md, the "unchanged" case which still surfaces in the regex).
import React from 'react';

export interface ModalProps {
  open: boolean;
  children: React.ReactNode;
}

export function Modal(props: ModalProps) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <div className="bg-white text-white text-opacity-75 shadow-md rounded-lg p-6">
        {props.children}
      </div>
    </div>
  );
}
