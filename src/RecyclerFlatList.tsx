import React from "react";
import {
  View,
  RefreshControl,
  FlatListProps,
  LayoutChangeEvent,
} from "react-native";
import {
  DataProvider,
  ProgressiveListView,
  RecyclerListView,
  RecyclerListViewProps,
} from "recyclerlistview";
import StickyContainer, { StickyContainerProps } from "recyclerlistview/sticky";

import AutoLayoutView, { BlankAreaEventHandler } from "./AutoLayoutView";
import ItemContainer from "./CellContainer";
import WrapperComponent, { PureComponentWrapper } from "./WrapperComponent";
import GridLayoutProviderWithProps from "./GridLayoutProviderWithProps";
import CustomError from "./errors/CustomError";
import ExceptionList from "./errors/ExceptionList";

interface StickyProps extends StickyContainerProps {
  children: any;
}
const StickyHeaderContainer =
  StickyContainer as React.ComponentClass<StickyProps>;

export interface RecyclerFlatListProps<T> extends FlatListProps<T> {
  // TODO: This is to make eslint silent. Out prettier and lint rules are conflicting.
  /**
   * Average or median size for elements in the list. Doesn't have to be very accurate but a good estimate can work better.
   * For vertical lists provide average height and for horizontal average width.
   */
  estimatedItemSize: number;

  /**
   * Visible height and width of the list. This is not the scroll content size.
   */
  estimatedListSize?: { height: number; width: number };

  /**
   * Provide estimated size of the header that is going to be rendered. This can help make initialScrollIndex prop more accurate.
   * You can also include any padding that might have been added to the start of the list. RecyclerFlatList needs to this to determine
   * where the first item in the list starts from.
   */
  estimatedHeaderSize?: number;

  /**
   * Draw distance for advanced rendering (in dp/px)
   */
  drawDistance?: number;

  /**
   * Allows developers to override type of items. This will improve recycling if you have different types of items in the list
   * Right type will be used for the right item. Default type is 0
   * If you don't want to change for an indexes just return undefined.
   * Performance: This method is called very frequently. Keep it fast.
   */
  overrideItemType?: (
    item: T,
    index: number,
    extraData?: any
  ) => string | number | undefined;

  /**
   * with numColumns > 1 you can choose to increase span of some of the items. You can also modify estimated height for some items.
   * Modify the given layout. Do not return.
   * Performance: This method is called very frequently. Keep it fast.
   */
  overrideItemLayout?: (
    layout: { span?: number; size?: number },
    item: T,
    index: number,
    maxColumns: number,
    extraData?: any
  ) => void;

  /**
   * For debugging and exception use cases, internal props will be overriden with these values if used
   */
  overrideProps?: object;

  /**
   * Computes blank space that is visible to the user during scroll or list load. If list doesn't have enough items to fill the screen even then this will be raised.
   * Values reported: {
   *    offsetStart -> visible blank space on top of the screen (while going up). If value is greater than 0 then it's visible to user.
   *    offsetEnd -> visible blank space at the end of the screen (while going down). If value is greater than 0 then it's visible to user.
   *    blankArea -> max(offsetStart, offsetEnd) use this directly and look for values > 0
   * }
   * Please note that this event isn't synced with onScroll event but works with native onDraw/layoutSubviews. Events with values > 0 are blanks.
   * This event is raised even when there is no visible blank with negative values for extensibility however, for most use cases check blankArea > 0 and use the value.
   */
  onBlankArea?: BlankAreaEventHandler;
}

export interface RecyclerFlatListState<T> {
  dataProvider: DataProvider;
  numColumns: number;
  layoutProvider: GridLayoutProviderWithProps<RecyclerFlatListProps<T>>;
  data?: ReadonlyArray<T> | null;
  extraData?: ExtraData<unknown>;
}

interface ExtraData<T> {
  value?: T;
}

// eslint-disable-next-line @shopify/react-initialize-state
class RecyclerFlatList<T> extends React.PureComponent<
  RecyclerFlatListProps<T>,
  RecyclerFlatListState<T>
> {
  private rlvRef?: RecyclerListView<RecyclerListViewProps, any>;
  private stickyContentContainerRef?: PureComponentWrapper;
  private listFixedDimensionSize = 0;
  private transformStyle = { transform: [{ scaleY: -1 }] };
  private distanceFromWindow = 0;

  static defaultProps = {
    data: [],
    numColumns: 1,
    estimatedHeaderSize: 0,
  };

  constructor(props) {
    super(props);
    this.validateProps();
    if (props.estimatedListSize) {
      if (props.horizontal) {
        this.listFixedDimensionSize = props.estimatedListSize.height;
      } else {
        this.listFixedDimensionSize = props.estimatedListSize.width;
      }
    }
    this.distanceFromWindow = props.estimatedHeaderSize;
  }

  private validateProps() {
    if (this.props.onRefresh && typeof this.props.refreshing !== "boolean") {
      throw new CustomError(ExceptionList.refreshBooleanMissing);
    }
    if (!(this.props.estimatedItemSize > 0)) {
      throw new CustomError(ExceptionList.estimatedItemSizeMissing);
    }
    if (
      Number(this.props.stickyHeaderIndices?.length) > 0 &&
      this.props.horizontal
    ) {
      throw new CustomError(ExceptionList.stickyWhileHorizontalNotSupported);
    }
    if (Number(this.props.numColumns) > 1 && this.props.horizontal) {
      throw new CustomError(ExceptionList.columsWhileHorizontalNotSupported);
    }
  }

  // Some of the state variables need to update when props change
  static getDerivedStateFromProps<T>(
    nextProps: RecyclerFlatListProps<T>,
    prevState: RecyclerFlatListState<T> | undefined
  ): RecyclerFlatListState<T> {
    const oldState = prevState || RecyclerFlatList.getInitialMutableState();
    const newState = { ...oldState };
    if (oldState.numColumns !== nextProps.numColumns) {
      newState.numColumns = nextProps.numColumns || 1;
      newState.layoutProvider = RecyclerFlatList.getLayoutProvider<T>(
        newState.numColumns,
        nextProps
      );
    }
    if (nextProps.data !== oldState.data) {
      newState.data = nextProps.data;
      newState.dataProvider = oldState.dataProvider.cloneWithRows(
        nextProps.data as any[]
      );
      newState.extraData = { ...oldState.extraData };
    }
    if (nextProps.extraData !== oldState.extraData?.value) {
      newState.extraData = { value: nextProps.extraData };
    }
    newState.layoutProvider.updateProps(nextProps);
    return newState;
  }

  private static getInitialMutableState<T>(): RecyclerFlatListState<T> {
    return {
      data: null,
      layoutProvider: null!!,
      dataProvider: new DataProvider((r1, r2) => {
        return r1 !== r2;
      }),
      numColumns: 0,
    };
  }

  // Using only grid layout provider as it can also act as a listview, sizeProvider is a function to support future overrides
  private static getLayoutProvider<T>(
    numColumns: number,
    props: RecyclerFlatListProps<T>
  ) {
    return new GridLayoutProviderWithProps<RecyclerFlatListProps<T>>(
      // max span or, total columns
      numColumns,
      (index, props) => {
        // type of the item for given index
        const type = props.overrideItemType?.(
          props.data!![index],
          index,
          props.extraData
        );
        return type || 0;
      },
      (index, props, mutableLayout) => {
        // span of the item at given index, item can choose to span more than one column
        props.overrideItemLayout?.(
          mutableLayout,
          props.data!![index],
          index,
          numColumns,
          props.extraData
        );
        return mutableLayout?.span || 1;
      },
      (index, props, mutableLayout) => {
        // estimated size of the item an given index
        props.overrideItemLayout?.(
          mutableLayout,
          props.data!![index],
          index,
          numColumns,
          props.extraData
        );
        return mutableLayout?.size || props.estimatedItemSize;
      },
      props
    );
  }

  private onEndReached = () => {
    // known issue: RLV doesn't report distanceFromEnd
    this.props.onEndReached?.({ distanceFromEnd: 0 });
  };

  private getRefreshControl = () => {
    if (this.props.onRefresh) {
      return (
        <RefreshControl
          refreshing={Boolean(this.props.refreshing)}
          progressViewOffset={this.props.progressViewOffset}
          onRefresh={this.props.onRefresh}
        />
      );
    }
  };

  render() {
    if (this.state.dataProvider.getSize() === 0) {
      return this.getValidComponent(this.props.ListEmptyComponent);
    }

    const {
      drawDistance,
      removeClippedSubviews,
      stickyHeaderIndices,
      horizontal,
      onEndReachedThreshold,
      estimatedListSize,
      initialScrollIndex,
      style,
      ...restProps
    } = this.props;

    const finalDrawDistance = drawDistance === undefined ? 250 : drawDistance;

    return (
      <StickyHeaderContainer
        overrideRowRenderer={this.stickyRowRenderer}
        applyWindowCorrection={this.applyWindowCorrection}
        stickyHeaderIndices={stickyHeaderIndices}
      >
        <ProgressiveListView
          {...restProps}
          ref={this.recyclerRef}
          layoutProvider={this.state.layoutProvider}
          style={[style, this.getTransform()]}
          dataProvider={this.state.dataProvider}
          rowRenderer={this.rowRenderer}
          canChangeSize
          isHorizontal={Boolean(horizontal)}
          scrollViewProps={{
            onLayout: this.handleSizeChange,
            refreshControl: this.getRefreshControl(),
          }}
          forceNonDeterministicRendering
          renderItemContainer={this.itemContainer}
          renderContentContainer={this.container}
          onEndReached={this.onEndReached}
          onEndReachedThreshold={onEndReachedThreshold || undefined}
          extendedState={this.state.extraData}
          layoutSize={estimatedListSize}
          maxRenderAhead={3 * finalDrawDistance}
          finalRenderAheadOffset={finalDrawDistance}
          renderAheadStep={finalDrawDistance}
          initialRenderIndex={initialScrollIndex || undefined}
          {...this.props.overrideProps}
        />
      </StickyHeaderContainer>
    );
  }

  private handleSizeChange = (event: LayoutChangeEvent) => {
    const newSize = this.props.horizontal
      ? event.nativeEvent.layout.height
      : event.nativeEvent.layout.width;
    const oldSize = this.listFixedDimensionSize;
    this.listFixedDimensionSize = newSize;

    // >0 check is to avoid rerender on mount where it would be redundant
    if (oldSize > 0 && oldSize !== newSize) {
      this.rlvRef?.forceRerender();
    }
    if (this.props.onLayout) {
      this.props.onLayout(event);
    }
  };

  private container = (props, children) => {
    return (
      <>
        <PureComponentWrapper
          enabled={children.length > 0}
          contentStyle={this.props.contentContainerStyle}
          header={this.props.ListHeaderComponent}
          extraData={this.state.extraData}
          headerStyle={this.props.ListHeaderComponentStyle}
          inverted={this.props.inverted}
          renderer={this.header}
        />
        <AutoLayoutView
          {...props}
          onBlankAreaEvent={this.props.onBlankArea}
          onLayout={(event) => {
            this.distanceFromWindow = this.props.horizontal
              ? event.nativeEvent.layout.x
              : event.nativeEvent.layout.y;
          }}
        >
          {children}
        </AutoLayoutView>
        <PureComponentWrapper
          enabled={children.length > 0}
          contentStyle={this.props.contentContainerStyle}
          header={this.props.ListFooterComponent}
          extraData={this.state.extraData}
          headerStyle={this.props.ListFooterComponentStyle}
          inverted={this.props.inverted}
          renderer={this.footer}
        />
      </>
    );
  };

  private itemContainer = (props, parentProps, children) => {
    return (
      <ItemContainer
        {...props}
        style={{
          ...props.style,
          flexDirection: this.props.horizontal ? "row" : "column",
          alignItems: "stretch",
          ...this.getTransform(),
        }}
        index={parentProps.index}
      >
        <WrapperComponent
          extendedState={parentProps.extendedState}
          internalSnapshot={parentProps.internalSnapshot}
          dataHasChanged={parentProps.dataHasChanged}
          data={parentProps.data}
        >
          <View
            style={{
              flexDirection:
                !this.props.horizontal && this.props.numColumns === 1
                  ? "column"
                  : "row",
            }}
          >
            {children}
          </View>
        </WrapperComponent>
        {this.separator(parentProps.index)}
      </ItemContainer>
    );
  };

  private getTransform() {
    return this.props.inverted && this.transformStyle;
  }

  private separator = (index) => {
    const leadingItem = this.props.data?.[index];
    const trailingItem = this.props.data?.[index + 1];
    const props = {
      leadingItem,
      trailingItem,
      // TODO: Missing sections as we don't have this feature implemented yet. Implement section, leadingSection and trailingSection.
      // https://github.com/facebook/react-native/blob/8bd3edec88148d0ab1f225d2119435681fbbba33/Libraries/Lists/VirtualizedSectionList.js#L285-L294
    };
    const Separator = this.props.ItemSeparatorComponent;
    return Separator && <Separator {...props} />;
  };

  private header = () => {
    return (
      <View style={[this.props.ListHeaderComponentStyle, this.getTransform()]}>
        {this.getValidComponent(this.props.ListHeaderComponent)}
      </View>
    );
  };

  private footer = () => {
    return (
      <View style={[this.props.ListFooterComponentStyle, this.getTransform()]}>
        {this.getValidComponent(this.props.ListFooterComponent)}
      </View>
    );
  };

  private getValidComponent(component) {
    const PassedComponent = component;
    return (
      (React.isValidElement(PassedComponent) && PassedComponent) ||
      (PassedComponent && <PassedComponent />) ||
      null
    );
  }

  private applyWindowCorrection = (
    _,
    __,
    correctionObject: { windowShift: number }
  ) => {
    correctionObject.windowShift = -this.distanceFromWindow;
    this.checkAndUpdateStickyState();
  };

  private rowRenderer = (_, data, index, extraData) => {
    // known issue: expected to pass separators which isn't available in RLV
    return this.props.renderItem?.({
      item: data,
      index,
      extraData: extraData?.value,
    } as any) as JSX.Element;
  };

  private recyclerRef = (ref: any) => {
    this.rlvRef = ref;
  };

  private stickyContentRef = (ref: any) => {
    this.stickyContentContainerRef = ref;
  };

  private stickyRowRenderer = (_, data, index, extraData) => {
    return (
      <PureComponentWrapper
        ref={this.stickyContentRef}
        enabled={this.checkAndUpdateStickyState()}
      >
        {this.rowRenderer(_, data, index, extraData)}
      </PureComponentWrapper>
    );
  };

  private checkAndUpdateStickyState = () => {
    const currentOffset = this.rlvRef?.getCurrentScrollOffset() || 0;
    const state = currentOffset >= this.distanceFromWindow;
    this.stickyContentContainerRef?.setEnabled(state);
    return state;
  };

  // eslint-disable-next-line @shopify/react-prefer-private-members
  public scrollToEnd(params?: { animated?: boolean | null | undefined }) {
    this.rlvRef?.scrollToEnd(Boolean(params?.animated));
  }

  // TODO: Improve accuracy with headers
  // eslint-disable-next-line @shopify/react-prefer-private-members
  public scrollToIndex(params: {
    animated?: boolean | null | undefined;
    index: number;
    viewOffset?: number | undefined;
    viewPosition?: number | undefined;
  }) {
    // known issue: no support for view offset/position
    this.rlvRef?.scrollToIndex(params.index, Boolean(params.animated));
  }

  // eslint-disable-next-line @shopify/react-prefer-private-members
  public scrollToItem(params: {
    animated?: boolean | null | undefined;
    item: any;
    viewPosition?: number | undefined;
  }) {
    this.rlvRef?.scrollToItem(params.item, Boolean(params.animated));
  }

  // eslint-disable-next-line @shopify/react-prefer-private-members
  public scrollToOffset(params: {
    animated?: boolean | null | undefined;
    offset: number;
  }) {
    const x = this.props.horizontal ? params.offset : 0;
    const y = this.props.horizontal ? 0 : params.offset;
    this.rlvRef?.scrollToOffset(x, y, Boolean(params.animated));
  }

  // eslint-disable-next-line @shopify/react-prefer-private-members
  public getScrollableNode(): number | null {
    return this.rlvRef?.getScrollableNode?.() || null;
  }
}

export default RecyclerFlatList;
