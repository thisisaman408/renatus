// @ts-nocheck
// Tailwind v3 card — intentionally hits Rules 2, 3, 4, 5 of the v3→v4 pack.
import React from 'react';

export interface CardProps {
  title: string;
  body: string;
}

export function Card(props: CardProps) {
  return (
    <div className="bg-black bg-opacity-50 border-gray-200 border shadow-sm transform">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <p className="mt-2">{props.body}</p>
    </div>
  );
}
