import React from 'react';
import {
  fireEvent,
  render,
  screen,
  userEvent,
  within,
} from '@testing-library/react-native';
import {
  ImagePickerResponse,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import { Enjoyment, Fullness } from '../api/recipesClient';
import { PICKER_OPTIONS } from '../photoPicker';
import FinishSheet from './FinishSheet';

const mockedLaunchCamera = jest.mocked(launchCamera);
const mockedLaunchImageLibrary = jest.mocked(launchImageLibrary);

beforeEach(() => {
  mockedLaunchCamera.mockReset().mockResolvedValue({ didCancel: true });
  mockedLaunchImageLibrary.mockReset().mockResolvedValue({ didCancel: true });
});

type Props = React.ComponentProps<typeof FinishSheet>;
type Element = ReturnType<typeof screen.getByTestId>;

async function renderSheet(props: Partial<Props> = {}) {
  const handlers = {
    onSave: jest.fn(),
    onDiscard: jest.fn(),
    onClose: jest.fn(),
  };
  await render(
    <FinishSheet
      date="September 24, 2026"
      durationMinutes={42}
      recipeMinutes={null}
      notes=""
      changeSummary={null}
      saving={false}
      error={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

// The Modal host element around the sheet.
function modal(): Element {
  let node = screen.getByTestId('finish-save-button').parent;
  while (node && node.type !== 'Modal') node = node.parent;
  if (!node) throw new Error('No Modal around the sheet');
  return node;
}

function containsType(element: Element, type: string): boolean {
  return element.children.some(
    child =>
      typeof child !== 'string' &&
      (child.type === type || containsType(child, type)),
  );
}

const star = (count: number) =>
  screen.getByRole('radio', {
    name: `${count} star${count === 1 ? '' : 's'}`,
  });
const saveButton = () => screen.getByTestId('finish-save-button');
// The sheet is accessibilityViewIsModal, which hides its sibling backdrop
// from screen readers (and from default queries); it is still tappable.
const backdrop = () =>
  screen.getByRole('button', {
    name: 'Back to cooking',
    includeHiddenElements: true,
  });

describe('FinishSheet', () => {
  it('shows the title, the date and the time the clock measured', async () => {
    await renderSheet();

    expect(
      screen.getByRole('header', { name: 'How did it go?' }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('finish-duration-text')).toHaveTextContent(
      'September 24, 2026 · took 42 min',
    );
    expect(screen.queryByText(/recipe says/)).not.toBeOnTheScreen();
  });

  it("shows the recipe's own time when it has one", async () => {
    await renderSheet({ recipeMinutes: 35 });

    expect(screen.getByText('(recipe says 35 min)')).toBeOnTheScreen();
  });

  it('formats longer times in hours', async () => {
    await renderSheet({ durationMinutes: 75, recipeMinutes: 60 });

    expect(screen.getByTestId('finish-duration-text')).toHaveTextContent(
      'September 24, 2026 · took 1 hr 15 min',
    );
    expect(screen.getByText('(recipe says 1 hr)')).toBeOnTheScreen();
  });

  describe('rating', () => {
    it('starts with no stars filled and none checked', async () => {
      await renderSheet();

      for (const count of [1, 2, 3, 4, 5]) {
        expect(star(count)).not.toBeChecked();
        expect(star(count)).toHaveTextContent('☆');
      }
    });

    it('fills stars up to the tapped one and checks only that one', async () => {
      const user = userEvent.setup();
      await renderSheet();

      await user.press(star(4));

      for (const count of [1, 2, 3]) {
        expect(star(count)).toHaveTextContent('★');
        expect(star(count)).not.toBeChecked();
      }
      expect(star(4)).toHaveTextContent('★');
      expect(star(4)).toBeChecked();
      expect(star(5)).toHaveTextContent('☆');
      expect(star(5)).not.toBeChecked();
    });

    it('moves the rating to another star, and clears it when the current star is tapped again', async () => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(star(4));
      await user.press(star(2));

      expect(star(2)).toBeChecked();
      expect(star(4)).not.toBeChecked();
      expect(star(3)).toHaveTextContent('☆');

      await user.press(star(2));

      for (const count of [1, 2, 3, 4, 5]) {
        expect(star(count)).not.toBeChecked();
        expect(star(count)).toHaveTextContent('☆');
      }
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ rating: null }),
      );
    });

    it('says the rating can wait, before and after a star is picked', async () => {
      const user = userEvent.setup();
      await renderSheet();

      expect(
        screen.getByText('Not eaten yet? You can rate it later.'),
      ).toBeOnTheScreen();

      await user.press(star(3));

      expect(
        screen.getByText('Not eaten yet? You can rate it later.'),
      ).toBeOnTheScreen();
    });
  });

  it('prefills the notes from cooking mode and lets you edit them', async () => {
    const user = userEvent.setup();
    const { onSave } = await renderSheet({ notes: 'Step 2: lumpy' });

    const notes = screen.getByLabelText('Notes');
    expect(notes).toHaveDisplayValue('Step 2: lumpy');

    await user.type(notes, ', whisk longer');

    expect(notes).toHaveDisplayValue('Step 2: lumpy, whisk longer');
    await user.press(saveButton());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Step 2: lumpy, whisk longer' }),
    );
  });

  it('saves the clock time, rating and notes', async () => {
    const user = userEvent.setup();
    const { onSave, onClose, onDiscard } = await renderSheet({
      notes: 'Good',
    });

    await user.press(star(5));
    await user.press(screen.getByRole('button', { name: 'Save attempt' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      durationMinutes: 42,
      rating: 5,
      fullness: null,
      enjoyment: null,
      photo: null,
      notes: 'Good',
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  describe('How did you feel after?', () => {
    // The group View isn't an accessibility element, so not found by role.
    const fullnessGroup = () =>
      screen.getByLabelText('How did you feel after?');
    const fullness = (name: string) => screen.getByRole('radio', { name });

    it('asks the question with three unchosen answers', async () => {
      await renderSheet();

      expect(screen.getByText('How did you feel after?')).toBeOnTheScreen();
      expect(
        within(fullnessGroup())
          .getAllByRole('radio')
          .map(item => item.props.testID),
      ).toEqual([
        'finish-fullness-still-hungry',
        'finish-fullness-satisfied',
        'finish-fullness-very-full',
      ]);
      for (const name of ['Still hungry', 'Satisfied', 'Very full']) {
        expect(fullness(name)).not.toBeChecked();
      }
    });

    it('saves the chosen answer', async () => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(fullness('Very full'));

      expect(fullness('Very full')).toBeChecked();
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ fullness: Fullness.VeryFull }),
      );
    });

    it('saves null after the chosen answer is tapped again', async () => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(fullness('Satisfied'));
      await user.press(fullness('Satisfied'));

      expect(fullness('Satisfied')).not.toBeChecked();
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ fullness: null }),
      );
    });

    it('keeps the rating and the answer apart', async () => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(star(3));
      await user.press(fullness('Still hungry'));

      expect(star(3)).toBeChecked();
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          rating: 3,
          fullness: Fullness.StillHungry,
        }),
      );
    });
  });

  describe('Was it enjoyable to make?', () => {
    const enjoymentGroup = () =>
      screen.getByLabelText('Was it enjoyable to make?');
    const enjoyment = (name: string) => screen.getByRole('radio', { name });

    it('asks the question with three unchosen answers', async () => {
      await renderSheet();

      expect(screen.getByText('Was it enjoyable to make?')).toBeOnTheScreen();
      expect(
        within(enjoymentGroup())
          .getAllByRole('radio')
          .map(item => item.props.testID),
      ).toEqual([
        'finish-enjoyment-loved',
        'finish-enjoyment-fine',
        'finish-enjoyment-not-worth-it',
      ]);
      for (const name of [
        'Loved making it',
        'It was fine',
        'Not worth the effort',
      ]) {
        expect(enjoyment(name)).not.toBeChecked();
      }
    });

    it('saves the chosen answer, apart from rating and fullness', async () => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(star(2));
      await user.press(enjoyment('Loved making it'));
      await user.press(screen.getByRole('radio', { name: 'Satisfied' }));

      expect(enjoyment('Loved making it')).toBeChecked();
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          rating: 2,
          enjoyment: Enjoyment.Loved,
          fullness: Fullness.Satisfied,
        }),
      );
    });

    it('saves null after the chosen answer is tapped again', async () => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(enjoyment('It was fine'));
      await user.press(enjoyment('It was fine'));

      expect(enjoyment('It was fine')).not.toBeChecked();
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ enjoyment: null }),
      );
    });
  });

  describe('photo of what you made', () => {
    const takeButton = () => screen.getByTestId('finish-take-photo-button');
    const chooseButton = () => screen.getByTestId('finish-choose-photo-button');
    const photo = () => screen.getByLabelText('Photo of what you made');
    const cameraError = () => screen.queryByTestId('finish-camera-error-text');
    const picked = (name: string): ImagePickerResponse => ({
      assets: [{ uri: `file:///${name}.jpg`, base64: `base64-${name}` }],
    });

    it('offers the camera and the gallery, with no photo yet', async () => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      expect(screen.getByText('A photo of what you made')).toBeOnTheScreen();
      expect(takeButton()).toHaveTextContent('Take photo');
      expect(chooseButton()).toHaveTextContent('Choose photo');
      expect(screen.queryByTestId('finish-photo')).not.toBeOnTheScreen();
      expect(cameraError()).not.toBeOnTheScreen();

      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ photo: null }),
      );
    });

    it('shows the photo taken with the camera and saves its base64', async () => {
      mockedLaunchCamera.mockResolvedValueOnce(picked('cake'));
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(takeButton());

      expect(mockedLaunchCamera).toHaveBeenCalledWith(PICKER_OPTIONS);
      expect(await screen.findByTestId('finish-photo')).toHaveProp('source', {
        uri: 'file:///cake.jpg',
      });
      expect(photo()).toBe(screen.getByTestId('finish-photo'));
      expect(
        screen.queryByTestId('finish-take-photo-button'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('finish-choose-photo-button'),
      ).not.toBeOnTheScreen();

      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ photo: 'base64-cake' }),
      );
    });

    it('chooses one photo from the gallery', async () => {
      mockedLaunchImageLibrary.mockResolvedValueOnce(picked('soup'));
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(chooseButton());

      expect(mockedLaunchImageLibrary).toHaveBeenCalledWith({
        ...PICKER_OPTIONS,
        selectionLimit: 1,
      });
      expect(await screen.findByTestId('finish-photo')).toHaveProp('source', {
        uri: 'file:///soup.jpg',
      });
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ photo: 'base64-soup' }),
      );
    });

    it('removes the photo, brings the buttons back and saves null', async () => {
      mockedLaunchCamera.mockResolvedValueOnce(picked('cake'));
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(takeButton());
      await user.press(
        await screen.findByRole('button', { name: 'Remove photo' }),
      );

      expect(screen.queryByTestId('finish-photo')).not.toBeOnTheScreen();
      expect(takeButton()).toBeOnTheScreen();
      expect(chooseButton()).toBeOnTheScreen();
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ photo: null }),
      );
    });

    it('keeps no photo and shows no error when the camera is cancelled', async () => {
      const user = userEvent.setup();
      await renderSheet();

      await user.press(takeButton());

      expect(mockedLaunchCamera).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('finish-photo')).not.toBeOnTheScreen();
      expect(cameraError()).not.toBeOnTheScreen();
    });

    it('keeps no photo when the picker returns an asset without base64', async () => {
      mockedLaunchCamera.mockResolvedValueOnce({
        assets: [{ uri: 'file:///cake.jpg' }],
      });
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(takeButton());

      expect(screen.queryByTestId('finish-photo')).not.toBeOnTheScreen();
      await user.press(saveButton());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ photo: null }),
      );
    });

    it('says the camera failed, and clears that once a photo is chosen', async () => {
      mockedLaunchCamera.mockResolvedValueOnce({
        errorCode: 'camera_unavailable',
      });
      mockedLaunchImageLibrary.mockResolvedValueOnce(picked('soup'));
      const user = userEvent.setup();
      await renderSheet();

      await user.press(takeButton());

      expect(
        await screen.findByTestId('finish-camera-error-text'),
      ).toHaveTextContent(
        "Couldn't open the camera. You can still choose a photo.",
      );
      expect(screen.queryByTestId('finish-photo')).not.toBeOnTheScreen();

      await user.press(chooseButton());

      expect(await screen.findByTestId('finish-photo')).toBeOnTheScreen();
      expect(cameraError()).not.toBeOnTheScreen();
    });

    it('shows no error when the gallery fails', async () => {
      mockedLaunchImageLibrary.mockResolvedValueOnce({ errorCode: 'others' });
      const user = userEvent.setup();
      await renderSheet();

      await user.press(chooseButton());

      expect(mockedLaunchImageLibrary).toHaveBeenCalledTimes(1);
      expect(cameraError()).not.toBeOnTheScreen();
      expect(screen.queryByTestId('finish-photo')).not.toBeOnTheScreen();
    });
  });

  describe('correcting the time', () => {
    const editButton = () =>
      screen.getByRole('button', { name: 'Correct the cooking time' });
    const durationInput = () =>
      screen.getByLabelText('Cooking time in minutes');

    it('swaps the text for an input prefilled with the minutes', async () => {
      const user = userEvent.setup();
      await renderSheet({ durationMinutes: 75 });

      expect(editButton()).toBe(
        screen.getByTestId('finish-duration-edit-button'),
      );
      expect(
        screen.queryByTestId('finish-duration-input'),
      ).not.toBeOnTheScreen();

      await user.press(editButton());

      expect(durationInput()).toBe(screen.getByTestId('finish-duration-input'));
      expect(durationInput()).toHaveDisplayValue('75');
      expect(screen.getByText('min')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('finish-duration-text'),
      ).not.toBeOnTheScreen();
    });

    it('saves the unchanged value from the input', async () => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(editButton());
      await user.press(saveButton());

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ durationMinutes: 42 }),
      );
    });

    it.each([
      ['50', 50],
      [' 50 ', 50],
      ['0', 0],
      ['', null],
      ['   ', null],
      ['abc', null],
      ['4.5', null],
      ['-5', null],
    ])('saves %j as durationMinutes %p', async (typed, expected) => {
      const user = userEvent.setup();
      const { onSave } = await renderSheet();

      await user.press(editButton());
      await user.clear(durationInput());
      if (typed) await user.type(durationInput(), typed);
      await user.press(saveButton());

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ durationMinutes: expected }),
      );
    });
  });

  it('shows the change summary only when given', async () => {
    await renderSheet({ changeSummary: 'You changed 1 ingredient.' });

    expect(screen.getByTestId('finish-changes-text')).toHaveTextContent(
      'You changed 1 ingredient.',
    );

    await screen.rerender(
      <FinishSheet
        date="September 24, 2026"
        durationMinutes={42}
        recipeMinutes={null}
        notes=""
        changeSummary={null}
        saving={false}
        error={null}
        onSave={jest.fn()}
        onDiscard={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('finish-changes-text')).not.toBeOnTheScreen();
  });

  it('shows the error when saving failed', async () => {
    await renderSheet({ error: 'Recipe not found' });

    expect(screen.getByTestId('finish-error-text')).toHaveTextContent(
      'Recipe not found',
    );
    expect(saveButton()).toBeEnabled();
  });

  it('shows no error text without an error', async () => {
    await renderSheet();

    expect(screen.queryByTestId('finish-error-text')).not.toBeOnTheScreen();
  });

  describe('while saving', () => {
    it('shows a spinner in a disabled, busy Save button', async () => {
      const user = userEvent.setup();
      const { onSave, onDiscard } = await renderSheet({ saving: true });

      expect(saveButton()).toBeDisabled();
      expect(saveButton()).toBeBusy();
      expect(containsType(saveButton(), 'ActivityIndicator')).toBe(true);
      expect(screen.queryByText('Save attempt')).not.toBeOnTheScreen();
      expect(screen.getByTestId('finish-discard-button')).toBeDisabled();

      await user.press(saveButton());
      await user.press(screen.getByTestId('finish-discard-button'));

      expect(onSave).not.toHaveBeenCalled();
      expect(onDiscard).not.toHaveBeenCalled();
    });

    it('does not close from the backdrop or the Android back button', async () => {
      const user = userEvent.setup();
      const { onClose } = await renderSheet({ saving: true });

      await user.press(backdrop());
      await fireEvent(modal(), 'requestClose');

      expect(onClose).not.toHaveBeenCalled();
    });

    it('has no spinner when not saving', async () => {
      await renderSheet();

      expect(saveButton()).toBeEnabled();
      expect(saveButton()).not.toBeBusy();
      expect(containsType(saveButton(), 'ActivityIndicator')).toBe(false);
    });
  });

  it('calls onDiscard from Discard', async () => {
    const user = userEvent.setup();
    const { onDiscard, onSave, onClose } = await renderSheet();

    await user.press(screen.getByRole('button', { name: 'Discard' }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose from the backdrop and from the Android back button', async () => {
    const user = userEvent.setup();
    const { onClose, onSave, onDiscard } = await renderSheet();

    await user.press(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent(modal(), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(2);

    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
