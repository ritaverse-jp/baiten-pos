import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('アプリのシェルが描画される', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: '売店レジ' })).toBeInTheDocument()
})
