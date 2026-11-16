import {
  Dialog as Modal,
  DialogTrigger as ModalTrigger,
  DialogPortal as ModalPortal,
  DialogOverlay as ModalOverlay,
  DialogContent as ModalContent,
  DialogTitle as ModalTitle,
  DialogDescription as ModalDescription,
} from '../Dialog';

// Re-exporting Dialog primitives under the Modal namespace for semantic architectural clarity,
// as Modal and Dialog share the same structural overlay pattern in the Figma design (502px max width),
// but differ semantically in usage (Forms/Content vs Short Decisions).
export {
  Modal,
  ModalTrigger,
  ModalPortal,
  ModalOverlay,
  ModalContent,
  ModalTitle,
  ModalDescription,
};
