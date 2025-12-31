# test_imports.py
print('Testing imports...')
try:
    with open('app.py', 'r', encoding='utf-8') as f:
        exec(f.read())
    print('\n√ All imports completed successfully!')
except Exception as e:
    print(f'\n? Import error: {e}')
    import traceback
    traceback.print_exc()