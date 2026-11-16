import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Modal, ModalContent, ModalTitle, ModalDescription, ModalOverlay, ModalPortal } from './Modal';

describe('Modal Component', () => {
  it('renders modal content correctly', () => {
    render(
      <Modal open={true}>
        <ModalPortal>
          <ModalOverlay />
          <ModalContent>
            <ModalTitle>Modal Title</ModalTitle>
            <ModalDescription>Modal Description</ModalDescription>
          </ModalContent>
        </ModalPortal>
      </Modal>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Modal Title')).toBeInTheDocument();
    expect(screen.getByText('Modal Description')).toBeInTheDocument();
  });
});
