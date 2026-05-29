def create_board():
    return [' '] * 9


def print_board(board):
    print()
    for i in range(0, 9, 3):
        print(f'  {board[i]} | {board[i+1]} | {board[i+2]} ')
        if i < 6:
            print(' ---+---+---')
    print()


def print_position_guide():
    print("\n  Position guide:")
    for i in range(0, 9, 3):
        print(f'  {i+1} | {i+2} | {i+3} ')
        if i < 6:
            print(' ---+---+---')
    print()


WINNING_COMBOS = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],  # rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],  # columns
    [0, 4, 8], [2, 4, 6],             # diagonals
]


def check_winner(board, player):
    return any(all(board[i] == player for i in combo) for combo in WINNING_COMBOS)


def is_draw(board):
    return ' ' not in board


def get_move(board, player):
    while True:
        try:
            raw = input(f"  Player {player} — enter position (1-9): ").strip()
            move = int(raw) - 1
            if 0 <= move <= 8 and board[move] == ' ':
                return move
            elif 0 <= move <= 8:
                print("  That spot is taken. Try again.")
            else:
                print("  Enter a number between 1 and 9.")
        except ValueError:
            print("  Enter a number between 1 and 9.")


def play_game():
    board = create_board()
    current = 0
    players = ['X', 'O']

    print_position_guide()

    while True:
        print_board(board)
        player = players[current]
        move = get_move(board, player)
        board[move] = player

        if check_winner(board, player):
            print_board(board)
            print(f"  Player {player} wins!\n")
            return

        if is_draw(board):
            print_board(board)
            print("  It's a draw!\n")
            return

        current = 1 - current


def main():
    print("\n=== Tic Tac Toe ===")
    print("Two players take turns. First to get three in a row wins.")

    while True:
        play_game()
        again = input("  Play again? (y/n): ").strip().lower()
        if again != 'y':
            print("\n  Thanks for playing!\n")
            break


if __name__ == '__main__':
    main()
