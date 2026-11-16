import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from './Pagination';

const meta = {
  title: 'Components/Pagination',
  component: Pagination,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreePages: Story = {
  render: () => <Pagination>
    <PaginationContent>
      <PaginationItem><PaginationPrevious /></PaginationItem>
      <PaginationItem><PaginationLink isActive>1</PaginationLink></PaginationItem>
      <PaginationItem><PaginationLink>2</PaginationLink></PaginationItem>
      <PaginationItem><PaginationLink>3</PaginationLink></PaginationItem>
      <PaginationItem><PaginationNext /></PaginationItem>
    </PaginationContent>
  </Pagination>,
};
